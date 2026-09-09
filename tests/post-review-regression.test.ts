import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isMissingPostModerationHistoryTableError } from '../lib/post-moderation-history'

const read = (path: string) => readFileSync(path, 'utf8')
const legacyReviewPage = read('app/admin/posts/review/page.tsx')
const reviewRoute = read('app/api/admin/posts/review/route.ts')
const reviewCenterRoute = read('app/api/admin/review/route.ts')
const reviewCenter = read('app/admin/review/ReviewCenter.tsx')
const reviewList = reviewRoute.slice(reviewRoute.indexOf('export async function GET'), reviewRoute.indexOf('export async function PATCH'))
const audit = read('lib/admin-audit.ts')
const history = read('lib/post-moderation-history.ts')
const postModeration = read('lib/post-moderation.ts')

test('审核首屏不依赖通知读写，也不把可选审核历史关系绑进主列表查询', () => {
  assert.match(legacyReviewPage, /redirect\('\/admin\/review\?type=post'\)/)
  assert.doesNotMatch(legacyReviewPage, /markModerationNotificationsRead|emitRealtime|loadPostModerationHistoryByPostIds/)
  assert.doesNotMatch(reviewCenterRoute, /markModerationNotificationsRead|emitRealtime|PostModerationHistory:\s*\{\s*orderBy/)
  assert.match(reviewCenterRoute, /loadTypeItems\(definition\.type, status, keyword, prefetchSize\)/)
  assert.match(reviewCenterRoute, /loadTypeItems\(definition\.type, 'ALL', keyword, 1, targetId\)/)
  assert.doesNotMatch(reviewCenterRoute, /queryStatus|targetId \? 1 : prefetchSize/)
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
  assert.match(reviewList, /\? \{ isDeleted: false, \.\.\.keywordFilter \}/)
  assert.match(reviewList, /\{ moderationStatus: status, isDeleted: false, \.\.\.keywordFilter \}/)
  assert.match(postModeration, /The moderation state is deliberately separate from Post\.status/)
})

test('审核历史异常不会污染列表响应模型', () => {
  assert.match(reviewRoute, /PostModerationHistory: history\.map/)
  assert.match(reviewRoute, /historyByPostId\.get\(post\.id\) \|\| \[\]/)
  assert.match(history, /const result = new Map<string, PostModerationHistoryRow\[\]>\(\)/)
  assert.doesNotMatch(reviewCenterRoute, /PostModerationHistory/)
})

test('审核列表第一页、第二页和空状态使用同一分页契约', () => {
  assert.match(reviewCenterRoute, /const page = Number\.isInteger\(rawPage\)/)
  assert.match(reviewCenterRoute, /const prefetchSize = Math\.max\(PAGE_SIZE \* 3, PAGE_SIZE \* page\)/)
  assert.match(reviewCenterRoute, /items,/)
  assert.match(reviewCenterRoute, /hasMore: start \+ PAGE_SIZE < total/)
  assert.match(reviewCenter, /async function loadMore\(\)/)
  assert.match(reviewCenter, /setItems\(\(current\) => \[\.\.\.current, \.\.\.\(Array\.isArray\(data\?\.items\)/)
  assert.match(reviewCenter, /!loading && !items\.length/)
})
