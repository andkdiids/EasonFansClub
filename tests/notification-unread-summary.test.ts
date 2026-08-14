import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildUnreadSummary } from '../lib/notifications'

const read = (path: string) => readFileSync(path, 'utf8')

test('unread summary counts full database categories as notification items', () => {
  const summary = buildUnreadSummary({
    replies: 2,
    likes: 1,
    friendRequests: 1,
    messages: 0,
    feedback: 0,
    system: 1,
  }, 0, 0)

  assert.equal(summary.total, 5)
  assert.equal(summary.notifications, 4)
  assert.equal(summary.replies, 2)
  assert.equal(summary.likes, 1)
  assert.equal(summary.friendRequests, 1)
  assert.equal(summary.system, 1)
})

test('summary is independent of notification pagination', () => {
  const summary = buildUnreadSummary({
    replies: 45,
    likes: 0,
    friendRequests: 0,
    messages: 0,
    feedback: 0,
    system: 0,
  }, 0, 0)

  assert.equal(summary.total, 45)
  assert.equal(summary.replies, 45)
})

test('all unread sources use the same isRead authority and preserve failures', () => {
  const service = read('lib/notifications.ts')
  const layout = read('app/layout.tsx')
  const summaryRoute = read('app/api/notifications/unread-summary/route.ts')
  const countRoute = read('app/api/notifications/unread-count/route.ts')
  const provider = read('components/NotificationProvider.tsx')

  assert.match(service, /isRead: false/)
  assert.match(service, /AND n\.isRead = 0/)
  assert.match(service, /export async function getUnreadNotificationCount\(userId: string\)[\s\S]*getUnreadSummary\(userId\)/)
  assert.doesNotMatch(layout, /getUnreadSummary\(sessionUser\.id\)\.catch/)
  assert.match(summaryRoute, /UNREAD_SUMMARY_UNAVAILABLE/)
  assert.match(summaryRoute, /status: 503/)
  assert.match(countRoute, /UNREAD_SUMMARY_UNAVAILABLE/)
  assert.match(provider, /cache: 'no-store'/)
  assert.match(provider, /if \(!response\.ok\) return/)
})

test('mark-all-read and clear-all are server-side full-user operations', () => {
  const service = read('lib/notifications.ts')
  const route = read('app/api/notifications/route.ts')

  assert.match(service, /markAllUnifiedNotificationsRead\(userId: string\)/)
  assert.match(service, /isRead: false[\s\S]*data: \{ isRead: true, readAt: now \}/)
  assert.match(route, /const clearAll = body\?\.all === true/)
  assert.match(route, /notification\.deleteMany\(\{[\s\S]*where: \{ recipientId: guard\.user\.id \}/)
})
