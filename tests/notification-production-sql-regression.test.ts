import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildUnreadSummary,
  getNotificationCategory,
  getNotificationCategoryFilter,
  getUnreadNotificationWhere,
} from '../lib/notifications'

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('lib/notifications.ts')

function summaryBlock() {
  const start = service.indexOf('async function loadUnreadSummary')
  const end = service.indexOf('export async function getUnreadNotificationCount')
  assert.ok(start >= 0 && end > start)
  return service.slice(start, end)
}

test('canReview=false 使用稳定的 review=0 SQL 片段', () => {
  const summary = summaryBlock()
  assert.ok(summary.includes(': Prisma.sql`0`'))
  assert.ok(summary.includes('${reviewCountSql} AS review'))
  assert.doesNotMatch(summary, /COUNT\(CASE WHEN \$\{canReview \?/)
})

test('canReview=true 使用完整合法的 review CASE 表达式', () => {
  const summary = summaryBlock()
  assert.match(summary, /COUNT\(\s*CASE\s+WHEN/)
  assert.match(summary, /THEN 1\s+END/)
  assert.match(summary, /n\.\\`key\\`/)
})

test('post-review ADMIN 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/posts/review', 'post-review:p1'), 'review')
})

test('sticker-pack-review 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/stickers', 'sticker-pack-review:pack1'), 'review')
})

test('sticker-pack-resubmit 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/stickers', 'sticker-pack-resubmit:pack1'), 'review')
})

test('today-review 通知归入审核', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/today', 'today-review:item1'), 'review')
})

test('feedback-new 不归入系统', () => {
  assert.equal(getNotificationCategory('ADMIN', '/admin/feedback', 'feedback-new:f1'), 'feedback')
  assert.notEqual(getNotificationCategory('ADMIN', '/admin/feedback', 'feedback-new:f1'), 'system')
})

test('FEEDBACK 类型归入反馈', () => {
  assert.equal(getNotificationCategory('FEEDBACK', '/admin/feedback/f1', null), 'feedback')
})

test('普通活动报名 ACTIVITY 归入系统', () => {
  assert.equal(getNotificationCategory('ACTIVITY', '/activities/a1', 'activity-registration-success:a1:u1'), 'system')
})

test('REPLY 归入回复', () => {
  assert.equal(getNotificationCategory('REPLY', '/posts/p1', 'reply:r1'), 'reply')
})

test('LIKE 归入点赞', () => {
  assert.equal(getNotificationCategory('LIKE', '/posts/p1', 'like:p1:u1'), 'like')
})

test('readAt=null 是普通通知的未读过滤条件', () => {
  assert.deepEqual(getUnreadNotificationWhere('user-1'), { recipientId: 'user-1', readAt: null })
})

test('readAt 非空不会被普通未读过滤器选中', () => {
  const where = getUnreadNotificationWhere('user-1')
  assert.equal(where.readAt, null)
  assert.doesNotMatch(JSON.stringify(where), /isRead/)
})

test('单条已读接口写入 readAt 并限定 recipientId', () => {
  const route = read('app/api/notifications/[notificationId]/read/route.ts')
  assert.match(route, /markUnifiedNotificationReadWithState\(guard\.user\.id/)
  assert.match(service, /where: getUnreadNotificationWhere\(userId, \{ id \}\)/)
  assert.match(service, /data: \{ isRead: true, readAt \}/)
})

test('全部已读使用 readAt 批量更新', () => {
  assert.match(service, /markAllUnifiedNotificationsRead\(userId: string\)/)
  assert.match(service, /where: getUnreadNotificationWhere\(userId\)[\s\S]*data: \{ isRead: true, readAt: now \}/)
})

test('普通用户不能看到审核分类', () => {
  assert.deepEqual(getNotificationCategoryFilter('review'), { id: { in: [] } })
})

test('具备审核权限的用户可以看到审核分类', () => {
  assert.match(JSON.stringify(getNotificationCategoryFilter('review', true)), /REVIEW/)
})

test('分类 count 与列表 SQL 使用相同的反馈/审核/系统判定片段', () => {
  const feedbackFilter = JSON.stringify(getNotificationCategoryFilter('feedback'))
  const reviewFilter = JSON.stringify(getNotificationCategoryFilter('review', true))
  const systemFilter = JSON.stringify(getNotificationCategoryFilter('system', true))
  assert.match(feedbackFilter, /FEEDBACK/)
  assert.match(reviewFilter, /post-review:/)
  assert.match(systemFilter, /FEEDBACK/)
  assert.match(service, /case 'feedback':[\s\S]*n\.type = 'FEEDBACK'/)
  assert.match(service, /case 'review':[\s\S]*n\.type = 'REVIEW'/)
  assert.match(service, /case 'system':[\s\S]*n\.type NOT IN/)
})

test('私信 unread 不计入 Notification.total', () => {
  const summary = buildUnreadSummary({
    replies: 1,
    likes: 0,
    friendRequests: 0,
    messages: 9,
    feedback: 0,
    system: 0,
    review: 0,
  }, 0, 9)
  assert.equal(summary.directMessages, 9)
  assert.equal(summary.total, 1)
})

test('所有 Notification.key 原生 SQL 引用均使用反引号', () => {
  assert.doesNotMatch(service, /n\.key\b/)
  assert.doesNotMatch(service, /COALESCE\(n\.key/)
  assert.ok(service.includes('n.\\`key\\`'))
})

test('核心汇总或列表查询失败时不伪造未读 0', () => {
  assert.match(service, /unread-summary\.personal-query'[\s\S]*throw personalResult\.reason/)
  assert.match(service, /const getRequiredCount[\s\S]*throw result\.reason/)
  assert.match(service, /return \{[\s\S]*unreadCount: personalUnread \+ systemUnread,[\s\S]*failed: true/)
  assert.match(read('app/layout.tsx'), /Do not turn an unavailable core query into a false "0 unread" badge/)
  assert.match(read('components/NotificationProvider.tsx'), /summaryAvailable/)
  assert.match(read('app/notifications/NotificationsClient.tsx'), /unreadCount === null \? '暂不可用'/)
  assert.match(read('app/notifications/NotificationsClient.tsx'), /!loadError && pagination\.totalPages > 1/)
  assert.match(read('components/FriendDock.tsx'), /unreadSummaryAvailable/)
  assert.match(read('components/UserNotificationMenu.tsx'), /summaryAvailable && summary\.total/)
})
