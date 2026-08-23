import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('system notifications open a detail dialog instead of the hash fallback', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const dialog = read('components/SystemNotificationDialog.tsx')

  assert.match(client, /const systemNotification = isSystemNotification\(item\)/)
  assert.match(client, /const target = systemNotification \? null : getNotificationTarget\(item\)/)
  assert.match(client, /if \(systemNotification\) openSystemNotification\(item\)/)
  assert.match(client, /void markRead\(item\)[\s\S]*setSelectedSystemNotification\(item\)/)
  assert.match(client, /<SystemNotificationDialog/)
  assert.match(dialog, /role="dialog"/)
  assert.match(dialog, /aria-modal="true"/)
  assert.match(dialog, /关闭系统通知详情/)
})

test('system notification details preserve full multiline text and support safe internal actions', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const dialog = read('components/SystemNotificationDialog.tsx')
  const service = read('lib/notifications.ts')
  const adminRoute = read('app/api/admin/system-notifications/route.ts')
  const adminForm = read('app/admin/notifications/NotificationBroadcastForm.tsx')

  assert.match(client, /safeInternalPathOrNull\(selectedSystemNotification\.link\)/)
  assert.match(client, /router\.push\(target\)/)
  assert.match(dialog, /whitespace-pre-wrap/)
  assert.match(dialog, /overflow-y-auto/)
  assert.match(dialog, /max-h-\[88vh\]/)
  assert.doesNotMatch(dialog, /dangerouslySetInnerHTML/)
  assert.match(service, /content: true/)
  assert.match(adminRoute, /const title = sanitizeText\(body\?\.title, 100\)/)
  assert.match(adminRoute, /const content = sanitizeText\(body\?\.content, 8000\)/)
  assert.match(adminForm, /<textarea[\s\S]*form\.content/)
})

test('ordinary notification navigation remains separate from system notification details', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /else if \(target\) void navigateToNotification\(item\)/)
  assert.match(client, /async function navigateToNotification\(item: UnifiedNotification\)[\s\S]*await markRead\(item\)[\s\S]*router\.push\(target\)/)
  assert.match(client, /if \(isSystemNotification\(item\)\) return null/)
})

test('system notification details keep the selected snapshot while the list refreshes', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /useState<UnifiedNotification \| null>\(null\)/)
  assert.match(client, /notification=\{selectedSystemNotification\}/)
  assert.match(client, /onClose=\{\(\) => setSelectedSystemNotification\(null\)\}/)
})
