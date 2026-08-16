import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const detail = read('app/posts/[postId]/page.tsx')
const actions = read('components/PostActions.tsx')
const route = read('app/api/posts/[postId]/route.ts')
const rewards = read('lib/community-rewards.ts')
const growth = read('lib/growth.ts')
const schema = read('prisma/schema.prisma')

test('设为精华从详情菜单走 PATCH，并在成功后同步菜单和详情状态', () => {
  assert.match(actions, /updatePost\(\{ isFeatured: !isFeatured \}\)/)
  assert.match(actions, /method: 'PATCH'/)
  assert.match(actions, /`\/api\/posts\/\$\{postId\}`/)
  assert.match(actions, /isFeatured \? '取消精华' : '设为精华'/)
  assert.match(actions, /router\.refresh\(\)/)
  assert.match(detail, /isFeatured/)
})

test('精华权限使用 post_manage，作者身份不会替代管理权限', () => {
  assert.match(route, /const canManagePosts = await hasAdminPermission\(guard\.user, 'post_manage'\)/)
  assert.match(route, /if \(changesModeration && !canManagePosts\)/)
  assert.doesNotMatch(route, /role\s*!==\s*['"]ADMIN['"]|isAdmin\s*&&\s*data\.isFeatured/)
})

test('首次状态转换才进入精华奖励，取消或重复请求不会再次奖励', () => {
  assert.match(route, /if \(data\.isFeatured === true && !lockedExisting\.isFeatured\)/)
  assert.match(rewards, /businessKey: `community:featured-post:\$\{input\.postId\}`/)
  assert.match(rewards, /if \(existingReward\) return/)
  assert.match(rewards, /existingExperienceReward/)
  assert.match(rewards, /sourceType_sourceId/)
  assert.match(growth, /FEATURED_POST: 'FEATURED_POST'/)
})

test('精华奖励保持每日限制和 27 + 27 额度', () => {
  assert.match(rewards, /featuredPost: 27/)
  assert.match(rewards, /featuredPostExperience: 27/)
  assert.match(rewards, /featuredPostDaily: 1/)
  assert.match(rewards, /action: 'FEATURED_POST'/)
  assert.match(rewards, /amount: COMMUNITY_REWARD_POINTS\.featuredPostExperience/)
  assert.match(rewards, /sourceId: input\.postId/)
})

test('作者自己的帖子使用锁定记录中的 authorId，不依赖 actor/recipient 通知关系', () => {
  assert.match(route, /authorId: lockedExisting\.authorId/)
  const featureTransaction = route.slice(
    route.indexOf('if (data.isFeatured === true && !lockedExisting.isFeatured)'),
    route.indexOf('const changedPinned'),
  )
  assert.doesNotMatch(featureTransaction, /notification\.create/)
})

test('精华错误有独立 operation、phase 和可诊断错误分类', () => {
  assert.match(route, /const requestKind: 'feature' \| 'pin' \| 'manage'/)
  assert.match(route, /operation: getPostMutationOperation\(phase\)/)
  assert.match(route, /phase = 'feature-reward'/)
  assert.match(route, /phase = 'feature-audit'/)
  assert.match(route, /logPostEditError\(error, postId, guard\.user\.id, 'feature-audit'\)/)
  assert.match(route, /POST_FEATURE_SCHEMA_UNAVAILABLE/)
  assert.match(route, /POST_FEATURE_DATABASE_UNAVAILABLE/)
  assert.match(route, /prismaCode/)
  assert.match(route, /errorName/)
})

test('置顶仍走同一管理链路但保留独立 pin phase', () => {
  assert.match(route, /typeof body\?\.isPinned === 'boolean'/)
  assert.match(route, /const changedPinned = data\.isPinned !== undefined/)
  assert.match(route, /phase = 'pin-audit'/)
})

test('schema 包含当前精华状态和两类奖励幂等字段', () => {
  assert.match(schema, /isFeatured\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /businessKey\s+String\?\s+@unique/)
  assert.match(schema, /sourceType\s+String\?/)
  assert.match(schema, /sourceId\s+String\?/)
  assert.match(schema, /@@unique\(\[sourceType, sourceId\]\)/)
})
