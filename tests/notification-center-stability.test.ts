import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

test('notification page isolates non-core first-screen failures', () => {
  const page = read('app/notifications/page.tsx')
  assert.match(page, /Promise\.allSettled\(/)
  assert.match(page, /initialLoadError/)
  assert.doesNotMatch(page, /PageLayoutRenderer|getPublishedPageLayoutConfig|getDefaultPageLayoutConfig|layoutConfig|layout-editor/)
  assert.doesNotMatch(page, /const \[notifications, layoutConfig, appearance\] = await Promise\.all\(/)
})

test('notification list keeps rendering when optional queries or history links fail', () => {
  const service = read('lib/notifications.ts')
  assert.match(service, /Promise\.allSettled\(/)
  assert.match(service, /list\.union-query/)
  assert.match(service, /failed: true/)
  assert.doesNotMatch(service, /list\.personal-fallback-query/)
  assert.match(service, /该回复已被删除或不可查看/)
  assert.match(service, /degraded \? \{ degraded: true \}/)
  assert.match(service, /unreadCount: personalUnread \+ systemUnread,[\s\S]*failed: true/)
})

test('notification API does not repeat the summary query after loading the page', () => {
  const route = read('app/api/notifications/route.ts')
  assert.doesNotMatch(route, /getUnreadNotificationCount/)
  assert.match(route, /unreadCount: result\.unreadCount/)
  assert.match(route, /logNotificationError\('list'/)
  assert.match(route, /if \(result\.failed\)[\s\S]*status: 503/)
})

test('notification client uses server data for the initial render and has local retry UI', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const syncStart = client.indexOf("const sync = (event?: Event) =>")
  const syncEnd = client.indexOf("const onRealtimeEvent", syncStart)

  assert.ok(syncStart >= 0)
  assert.ok(syncEnd > syncStart)

  const syncHandler = client.slice(syncStart, syncEnd)
  assert.equal((syncHandler.match(/void refreshNotifications\(\)/g) || []).length, 1)
  assert.match(client, /通知加载失败，请重试/)
  assert.match(client, /loadError \|\| \(loadWarning && notifications\.length === 0\)/)
  assert.match(client, /onClick=\{\(\) => void refreshNotifications\(\)\}/)
})

test('notification errors are logged with safe structured fields', () => {
  const logger = read('lib/notification-errors.ts')
  assert.match(logger, /errorName/)
  assert.match(logger, /errorCode/)
  assert.match(logger, /message/)
  assert.match(logger, /redactSensitiveText/)
  assert.doesNotMatch(logger, /cookie\s*:/)
})
