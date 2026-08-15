import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isMissingPostModerationHistoryTableError } from '../lib/post-moderation-history'

const read = (path: string) => readFileSync(path, 'utf8')
const reviewPage = read('app/admin/posts/review/page.tsx')
const reviewRoute = read('app/api/admin/posts/review/route.ts')
const reviewManager = read('app/admin/posts/review/PostReviewManager.tsx')
const reviewList = reviewRoute.slice(0, reviewRoute.indexOf('export async function PATCH'))
const audit = read('lib/admin-audit.ts')
const history = read('lib/post-moderation-history.ts')
const postModeration = read('lib/post-moderation.ts')

test('审核首屏不依赖通知读写，也不把可选审核历史关系绑进主列表查询', () => {
  assert.doesNotMatch(reviewPage, /markModerationNotificationsRead|emitRealtime/)
  assert.match(reviewPage, /loadPostModerationHistoryByPostIds/)
  assert.doesNotMatch(reviewPage, /PostModerationHistory:\s*\{\s*orderBy/)
})

test('审核列表 GET 对历史表缺失和普通 Prisma 异常都有服务端日志与明确错误响应', () => {
  assert.match(reviewRoute, /try\s*\{[\s\S]*loadPostModerationHistoryByPostIds/)
  assert.match(reviewRoute, /console\.error\('\[admin\.posts\.review\.list\]'/)
  assert.match(reviewRoute, /status: 503/)
  assert.match(reviewRoute, /审核列表暂时无法加载，请稍后重试/)
})

test('缺少审核历史表只降级附加历史，不会回滚发帖、编辑或审核主事务', () => {
  assert.match(history, /return result/)
  assert.match(history, /console\.error\(`\[\$\{context\}\.history\]`/)
  assert.match(audit, /isMissingPostModerationHistoryTableError\(error\)/)
  assert.match(audit, /return null/)
  assert.equal(isMissingPostModerationHistoryTableError({ code: 'P2021', message: 'The table PostModerationHistory does not exist' }), true)
  assert.equal(isMissingPostModerationHistoryTableError({ code: 'P2021', message: 'The table Notification does not exist' }), false)
})

test('审核 GET 不执行违禁词扫描或通知发送，状态仍只使用 moderationStatus', () => {
  assert.doesNotMatch(reviewList, /checkPostForbiddenWords|notification\.create|notification\.updateMany/)
  assert.match(reviewList, /where: \{ moderationStatus: status, isDeleted: false \}/)
  assert.match(postModeration, /The moderation state is deliberately separate from Post\.status/)
})

test('审核历史异常不会污染列表响应模型', () => {
  assert.match(reviewRoute, /PostModerationHistory: history\.map/)
  assert.match(reviewRoute, /historyByPostId\.get\(post\.id\) \|\| \[\]/)
  assert.match(history, /const result = new Map<string, PostModerationHistoryRow\[\]>\(\)/)
})

test('审核列表第一页、第二页和空状态使用同一分页契约', () => {
  assert.match(reviewRoute, /const page = Number\.isInteger\(rawPage\)/)
  assert.match(reviewRoute, /skip: \(page - 1\) \* POST_REVIEW_PAGE_SIZE/)
  assert.match(reviewRoute, /take: POST_REVIEW_PAGE_SIZE \+ 1/)
  assert.match(reviewRoute, /page,\n\s+hasMore/)
  assert.match(reviewManager, /page - 1/)
  assert.match(reviewManager, /page \+ 1/)
  assert.match(reviewManager, /!posts\.length/)
})
