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
  assert.match(service, /existing\?\.isRead \? \{ ok: true, readAt: existing\.readAt \}/)
  assert.match(service, /update: \{\}/)
})

test('通知卡片和单条已读按钮先乐观移除未读样式，失败恢复原状态', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /setNotifications\(\(current\) => current\.map\(\(row\) => matchesItem\(row\)[\s\S]*isRead: true, read: true, readAt: optimisticReadAt/)
  assert.match(client, /data\?\.readAt === null[\s\S]*data\?\.readAt[\s\S]*new Date\(data\.readAt\)/)
  assert.match(client, /row\.readAt === optimisticReadAt[\s\S]*item\.isRead, read: item\.read, readAt: item\.readAt/)
  assert.match(client, /onClick=\{\(event\) => \{[\s\S]*void markRead\(item\)/)
  assert.match(client, /!isNotificationRead\(item\) \? \([\s\S]*>\s*已读\s*</)
  assert.match(client, /emphasisClass = isBirthday && !isNotificationRead\(item\)/)
})
