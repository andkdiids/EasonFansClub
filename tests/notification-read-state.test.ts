import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('单条已读接口返回持久化 readAt，并对重复请求保持幂等', () => {
  const route = read('app/api/notifications/[notificationId]/read/route.ts')
  const service = read('lib/notifications.ts')

  assert.match(route, /markUnifiedNotificationReadWithState/)
  assert.match(route, /const readAt = result\.readAt[\s\S]*readAt,/)
  assert.match(route, /isRead: true/)
  assert.match(service, /updateMany\([\s\S]*data: \{ isRead: true, readAt \}/)
  assert.match(service, /existing\?\.readAt \? \{ ok: true, readAt: existing\.readAt \}/)
  assert.match(service, /update: \{\}/)
})

test('通知卡片和单条已读按钮先乐观移除未读样式，失败恢复原状态', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /const \{ summary: sharedSummary, summaryAvailable, updateSummary, refresh: refreshUnreadSummary \} = useNotificationSummary\(\)/)
  assert.doesNotMatch(client, /summaryOverride|setSummaryOverride/)
  assert.match(client, /updateSummary\(\(current\) => decrementUnreadSummary\(current, \[item\]\)\)[\s\S]*?fetch\(`/)
  assert.match(client, /setNotifications\(\(current\) => current\.map\(\(row\) => matchesItem\(row\)[\s\S]*isRead: true, read: true, readAt: optimisticReadAt/)
  assert.match(client, /data\?\.readAt === null[\s\S]*data\?\.readAt[\s\S]*new Date\(data\.readAt\)/)
  assert.match(client, /row\.readAt === optimisticReadAt[\s\S]*item\.isRead, read: item\.read, readAt: item\.readAt/)
  assert.match(client, /fetch\(`\/api\/notifications\/\$\{item\.id\}\/read`[\s\S]*keepalive: true/)
  assert.match(client, /async function navigateToNotification\(item: UnifiedNotification\)[\s\S]*await markRead\(item\)[\s\S]*router\.push\(target\)/)
  assert.match(client, /onClick=\{\(event\) => \{[\s\S]*void markRead\(item\)/)
  assert.match(client, /!isNotificationRead\(item\) \? \([\s\S]*>\s*已读\s*</)
  assert.match(client, /emphasisClass = isBirthday && !isNotificationRead\(item\)/)
})

test('重复点击和已读通知不会重复扣减全局未读数，失败后会重新同步', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /if \(isNotificationRead\(item\)\) return true/)
  assert.match(client, /if \(markingReadRef\.current\.has\(itemKey\)\) return true/)
  assert.match(client, /updateSummary\(\(current\) => incrementUnreadSummary\(current, \[item\]\)\)[\s\S]*void refreshUnreadSummary\(\)/)
  assert.match(client, /if \(!response\.ok \|\| data\?\.ok === false\)[\s\S]*return false/)
})
