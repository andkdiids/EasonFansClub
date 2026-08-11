import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('通知卡片、乐观计数和返回页面使用同一已读状态', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /function isNotificationRead\(item: UnifiedNotification\)/)
  assert.match(client, /isNotificationRead\(item\) \? 'is-read' : 'is-unread'/)
  assert.match(client, /setSummaryOverride\(decrementUnreadSummary\(unreadSummary, \[item\]\)\)/)
  assert.match(client, /persistOptimisticRead\(itemKey, optimisticReadAt\)/)
  assert.match(client, /window\.addEventListener\('pageshow', sync\)/)
  assert.match(client, /window\.addEventListener\('unread-summary:refresh', sync\)/)
  assert.match(client, /new URLSearchParams\(\{ page: String\(currentPage\), pageSize: String\(NOTIFICATION_LIST_PAGE_SIZE\) \}\)/)
  assert.match(client, /fetch\(`\/api\/notifications\?\$\{params\.toString\(\)\}`,[\s\S]*cache: 'no-store'/)
  assert.match(client, /mergeServerNotifications\(initialNotifications, initialPagination\)/)
  assert.match(client, /await refreshNotifications\(true\)/)
  assert.match(client, /setNotifications\(previousNotifications\)/)
})

test('通知列表 API 禁止缓存，返回服务端最新已读字段', () => {
  const route = read('app/api/notifications/route.ts')
  const service = read('lib/notifications.ts')

  assert.match(route, /export const dynamic = 'force-dynamic'/)
  assert.match(route, /Cache-Control.*private, no-store/)
  assert.match(route, /totalPages/)
  assert.match(route, /pageSize/)
  assert.match(service, /isRead: item\.isRead/)
  assert.match(service, /read: item\.isRead/)
  assert.match(service, /readAt: item\.readAt/)
  assert.match(service, /ORDER BY isRead ASC, createdAt DESC/)
})
