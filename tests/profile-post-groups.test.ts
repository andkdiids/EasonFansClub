import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MAX_PROFILE_POST_GROUPS,
  PROFILE_POST_GROUP_UNGROUPED,
  normalizeProfilePostGroupName,
} from '../lib/profile-post-groups'

const read = (path: string) => readFileSync(path, 'utf8')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260831090000_add_user_post_groups/migration.sql')
const publicModules = read('app/api/users/[userId]/public-modules/route.ts')
const groupListRoute = read('app/api/users/[userId]/post-groups/route.ts')
const groupCreateRoute = read('app/api/profile/post-groups/route.ts')
const groupMutationRoute = read('app/api/profile/post-groups/[groupId]/route.ts')
const assignmentRoute = read('app/api/posts/[postId]/profile-group/route.ts')
const profileModules = read('components/PublicUserModules.tsx')
const groupComponent = read('components/ProfilePostGroups.tsx')

test('personal post groups are per-user, ordered, unique, and nullable on Post', () => {
  assert.match(schema, /model UserPostGroup \{/u)
  assert.match(schema, /userPostGroupId\s+String\?/u)
  assert.match(schema, /UserPostGroup\s+UserPostGroup\?/u)
  assert.match(schema, /@@unique\(\[userId, name\]\)/u)
  assert.match(schema, /@@index\(\[userId, sortOrder, createdAt\]\)/u)
  assert.match(schema, /@@index\(\[authorId, userPostGroupId, createdAt\]\)/u)
  assert.match(migration, /CREATE TABLE `UserPostGroup`/u)
  assert.match(migration, /Post_userPostGroupId_fkey[\s\S]*ON DELETE SET NULL/u)
})

test('group names enforce trimming and the 20-group product limit', () => {
  assert.equal(MAX_PROFILE_POST_GROUPS, 20)
  assert.equal(PROFILE_POST_GROUP_UNGROUPED, '__ungrouped__')
  assert.equal(normalizeProfilePostGroupName('  经典讨论  '), '经典讨论')
  assert.equal(normalizeProfilePostGroupName(''), null)
  assert.equal(normalizeProfilePostGroupName('x'.repeat(21)), null)
  assert.match(groupCreateRoute, /MAX_PROFILE_POST_GROUPS/u)
  assert.match(groupCreateRoute, /FOR UPDATE/u)
})

test('public profile group filtering remains server-side and preserves pagination and visibility rules', () => {
  assert.match(publicModules, /PROFILE_POST_GROUP_UNGROUPED/u)
  assert.match(publicModules, /userPostGroupId: null/u)
  assert.match(publicModules, /userPostGroupId: requestedGroupId/u)
  assert.match(publicModules, /buildProfilePostWhere\(target\.id, canViewPendingPosts\)/u)
  assert.match(publicModules, /skip: \(pagination\.page - 1\) \* pagination\.pageSize/u)
  assert.match(publicModules, /take: pagination\.pageSize/u)
  assert.match(groupListRoute, /isProfileModuleVisible\(visibility\.settings, 'posts'/u)
  assert.match(groupListRoute, /where: \{ userId: target\.id \}/u)
})

test('create, rename, reorder, delete and assignment APIs enforce owner boundaries', () => {
  assert.match(groupMutationRoute, /requireUser\(\)/u)
  assert.match(groupMutationRoute, /where: \{ userId: guard\.user\.id \}/u)
  assert.match(groupMutationRoute, /direction === 'up'/u)
  assert.match(groupMutationRoute, /deleteMany\(\{ where: \{ id: groupId, userId: guard\.user\.id \} \}\)/u)
  assert.match(assignmentRoute, /post\.authorId !== guard\.user\.id/u)
  assert.match(assignmentRoute, /where: \{ id: groupId, userId: guard\.user\.id \}/u)
  assert.match(assignmentRoute, /userPostGroupId: groupId/u)
  assert.match(profileModules, /<PersonalPostGroupMenu/u)
  assert.match(profileModules, /<ProfilePostGroupBar/u)
  assert.match(groupComponent, /\/api\/profile\/post-groups/u)
  assert.match(groupComponent, /\/profile-group/u)
})

test('deleting a group leaves posts and turns the nullable relation into ungrouped', () => {
  assert.match(migration, /ON DELETE SET NULL/u)
  assert.doesNotMatch(migration, /DROP TABLE `Post`|DELETE FROM `Post`/u)
  assert.match(groupComponent, /帖子不会被删除，并会变为未分组/u)
  assert.match(groupComponent, /if \(activeGroupId === group\.id\) onSelect\(''\)\s*else onChanged\(\)/u)
})
