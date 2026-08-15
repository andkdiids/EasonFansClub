import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const route = read('app/api/posts/[postId]/route.ts')
const editHandler = route.slice(route.indexOf('async function handleEditPost'))
const form = read('components/PostEditForm.tsx')
const detail = read('app/posts/[postId]/page.tsx')
const actions = read('components/PostActions.tsx')

test('post detail management menu exposes the existing edit flow in permission order', () => {
  assert.match(detail, /postActions=\{canManagePost \|\| canDeletePost \|\| canEditPost \?/)
  assert.match(detail, /canEdit=\{canEditPost\}/)
  assert.match(actions, /canEdit: boolean/)
  assert.match(actions, /router\.push\(`\/posts\/\$\{postId\}\/edit`\)/)
  const menu = actions.slice(actions.indexOf('className="post-management-menu-panel"'))
  assert.ok(menu.indexOf('{canEdit ?') < menu.indexOf('{canManage ?'))
  assert.ok(menu.indexOf('{canManage ?') < menu.indexOf('{canDelete ?'))
})

test('帖子编辑使用真实 PATCH 路由、白名单字段并保留帖子身份', () => {
  assert.match(route, /export async function PATCH\(request: Request, \{ params \}: Params\)/)
  assert.match(form, /fetch\(`\/api\/posts\/\$\{postId\}`,[\s\S]*method: 'PATCH'/)
  assert.match(form, /JSON\.stringify\(\{ title, content, boardId, keepMediaIds, addImageUrls \}\)/)
  assert.match(form, /removePendingPostFromDiscoverySessions/)
  assert.match(form, /data\?\.moderationStatus === 'PENDING'/)
  assert.doesNotMatch(editHandler, /body\.(id|authorId|createdAt|updatedAt|likeCount|replyCount|ipRegion|moderationStatus)/)
  assert.match(editHandler, /data: \{[\s\S]*title: rawTitle,[\s\S]*content: rawContent,[\s\S]*summary: createSummary\(rawContent\),[\s\S]*boardId: nextBoardId/)
})

test('普通用户编辑沿用审核规则，但不会把附属功能失败升级成保存失败', () => {
  assert.match(editHandler, /moderationStatus: 'PENDING'/)
  assert.match(editHandler, /reviewedAt: null/)
  assert.match(editHandler, /reviewedById: null/)
  assert.match(editHandler, /checkPostForbiddenWords\(\{ title: rawTitle, content: rawContent \}, user\)/)
  assert.match(editHandler, /await createPostModerationHistory\(prisma,/)
  assert.match(editHandler, /await prisma\.notification\.createMany\(/)
  assert.match(editHandler, /await createAdminActionAudit\(prisma, transactionResult\.audit\)/)
  assert.doesNotMatch(editHandler, /createPostModerationHistory\(tx,/)
  assert.doesNotMatch(editHandler, /createAdminActionAudit\(tx,/)
  assert.match(editHandler, /logPostEditError\(error, postId, user\.id, 'edit-(moderation-history|review-notification|admin-audit)'\)/)
})

test('编辑服务端记录阶段和 Prisma 错误，并返回可识别的业务 HTTP 响应', () => {
  assert.match(route, /console\.error\('\[posts\.update\]'/)
  assert.match(route, /postId,\s*userId,\s*phase/)
  assert.match(route, /prismaCode: knownError \? error\.code : undefined/)
  assert.match(route, /P2022/)
  assert.match(route, /POST_EDIT_SCHEMA_UNAVAILABLE/)
  assert.match(route, /return postEditErrorResponse\(error, postId, guard\.user\.id, phase\)/)
  assert.match(form, /data\?\.message \|\| '保存失败，请稍后重试'/)
  assert.match(form, /router\.push\(`\/posts\/\$\{postId\}`\)/)
  assert.match(form, /disabled=\{submitting\}/)
})

test('编辑不触发发帖奖励、频率限制或重复创建帖子', () => {
  assert.doesNotMatch(editHandler, /createPost\(/)
  assert.doesNotMatch(editHandler, /registerFee|registrationFee|reward|awardExperience|dailyPostLimit|rateLimit/i)
  assert.match(editHandler, /tx\.post\.update\(/)
  assert.doesNotMatch(editHandler, /tx\.post\.create\(/)
})
