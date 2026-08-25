import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('通知专用事务有显式边界且当前路径没有默认五秒事务', () => {
  const transaction = read('lib/notification-transaction.ts')
  const likeNotifications = read('lib/like-notifications.ts')
  const notifications = read('lib/notifications.ts')

  assert.match(transaction, /timeout: 15_000/)
  assert.match(transaction, /maxWait: 5_000/)
  assert.match(likeNotifications, /safeNotificationTransaction\(/)
  assert.doesNotMatch(likeNotifications, /prisma\.\$transaction\(/)
  assert.doesNotMatch(likeNotifications, /tx\.notification\.findUnique\(/)
  assert.match(likeNotifications, /tx\.notification\.findMany\(/)

  const summaryStart = notifications.indexOf('async function loadUnreadSummary')
  const summaryEnd = notifications.indexOf('export async function getUnreadNotificationCount')
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart)
  assert.doesNotMatch(notifications.slice(summaryStart, summaryEnd), /reconcileLikeNotifications|reconcileStalePersonalNotifications/)
  assert.match(notifications, /unreadSummaryInFlight/)
})

test('点赞通知在核心点赞事务提交后后台执行并自行捕获异常', () => {
  for (const path of [
    'app/api/posts/[postId]/like/route.ts',
    'app/api/replies/[replyId]/like/route.ts',
  ]) {
    const route = read(path)
    assert.match(route, /void syncLikeNotification\(input\)/, path)
    assert.match(route, /like-notification-background/, path)
    assert.doesNotMatch(route, /await syncLikeNotification\(/, path)
  }
})
