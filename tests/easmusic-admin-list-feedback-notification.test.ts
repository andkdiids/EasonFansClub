import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('admin concert management uses server-side list pagination and filters', () => {
  const manager = read('app/admin/music/concerts/AdminConcertManager.tsx')
  const route = read('app/api/admin/music/concerts/route.ts')
  const bulkRoute = read('app/api/admin/music/concerts/bulk/route.ts')

  assert.match(manager, /全部场次列表/)
  assert.match(manager, /const PAGE_SIZE = 50/)
  assert.match(manager, /startDate/)
  assert.match(manager, /endDate/)
  assert.match(manager, /filters\.city/)
  assert.match(manager, /idsOnly/)
  assert.match(manager, /批量修改状态/)
  assert.match(manager, /批量设置海报/)
  assert.match(manager, /批量复制歌单/)
  assert.match(manager, /批量删除/)
  assert.match(route, /orderBy: \[\{ concertDate: 'asc' \}, \{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/)
  assert.match(route, /skip: \(page - 1\) \* pageSize/)
  assert.match(route, /take: pageSize/)
  assert.match(route, /pagination: \{ page, pageSize, total, totalPages:/)
  assert.match(bulkRoute, /'copy-setlist'/)
  assert.match(bulkRoute, /cloneSetlistItems\(source\.MusicConcertSetlistItem, targetId\)/)
})

test('feedback creation creates personal notifications for active administrators only', () => {
  const feedbackRoute = read('app/api/feedback/route.ts')

  assert.match(feedbackRoute, /role: \{ in: \['ADMIN', 'SUPER_ADMIN'\] \}/)
  assert.match(feedbackRoute, /status: 'ACTIVE'/)
  assert.match(feedbackRoute, /isDeleted: false/)
  assert.match(feedbackRoute, /tx\.notification\.createMany\(/)
  assert.match(feedbackRoute, /title: '收到新的用户反馈'/)
  assert.match(feedbackRoute, /link: '\/admin\/feedback'/)
  assert.match(feedbackRoute, /key: `feedback-new:\$\{created\.id\}`/)
  assert.doesNotMatch(feedbackRoute, /recipientId: guard\.user\.id/)
})

test('admin feedback notifications are included in unread-summary and notification center queries', () => {
  const notifications = read('lib/notifications.ts')

  assert.match(notifications, /getUnreadNotificationWhere\(userId\)/)
  assert.match(notifications, /getNotificationCategory\(item\.type, item\.link\)/)
  assert.doesNotMatch(notifications, /prisma\.friendRequest\.count\(/)
  assert.match(notifications, /prisma\.notification\.findMany\(/)
  assert.doesNotMatch(notifications, /NOT: \{ link: \{ startsWith: '\/admin\/feedback' \} \}/)
})

test('unread-summary uses one realtime client with an HTTP fallback', () => {
  const provider = read('components/NotificationProvider.tsx')
  const realtimeClient = read('lib/realtime-client.ts')
  const menu = read('components/UserNotificationMenu.tsx')
  const shell = read('components/layout/AppShell.tsx')
  const notificationsClient = read('app/notifications/NotificationsClient.tsx')

  assert.match(provider, /new RealtimeClient/)
  assert.match(provider, /eason-realtime:\$\{userId\}/)
  assert.match(provider, /BroadcastChannel/)
  assert.doesNotMatch(provider, /POLL_INTERVAL_MS/)
  assert.match(provider, /document\.addEventListener\('visibilitychange'/)
  assert.match(provider, /window\.addEventListener\('online'/)
  assert.match(realtimeClient, /\/ws/)
  assert.match(realtimeClient, /fallbackIntervalMs = 90_000/)
  assert.match(realtimeClient, /reconnectDelays = \[1000, 2000, 4000, 8000, 15_000, 30_000\]/)
  assert.doesNotMatch(shell, /fetch\('\/api\/notifications\/unread-summary'/)
  assert.doesNotMatch(shell, /window\.setInterval/)
  assert.doesNotMatch(menu, /fetch\('\/api\/notifications\/unread-summary'/)
  assert.doesNotMatch(menu, /window\.setInterval/)
  assert.doesNotMatch(notificationsClient, /fetch\('\/api\/notifications\/unread-summary'/)
})
