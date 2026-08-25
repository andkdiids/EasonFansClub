import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { shouldRefreshNotificationList } from '../lib/notification-refresh-policy'

const read = (path: string) => readFileSync(path, 'utf8')

test('summary-only realtime events never reload the notification list', () => {
  assert.equal(shouldRefreshNotificationList({ type: 'unread-summary', source: 'manual', changed: [] }), false)
  assert.equal(shouldRefreshNotificationList({ type: 'unread-summary', source: 'ws', changed: [] }), false)
  assert.equal(shouldRefreshNotificationList({ type: 'unread-summary', source: 'ws', changed: ['message'] }), false)
  assert.equal(shouldRefreshNotificationList({ type: 'unread-summary', source: 'ws', changed: ['notification'] }), true)
  assert.equal(shouldRefreshNotificationList({ type: 'unread-summary', source: 'fallback', changed: [] }), true)
  assert.equal(shouldRefreshNotificationList({ type: 'unread-summary', source: 'ws', changed: [], initial: true }), false)
})

test('notification list fetch and unread-summary refresh are one-way responsibilities', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const provider = read('components/NotificationProvider.tsx')

  assert.match(client, /fetch\(`\/api\/notifications\?\$\{params\.toString\(\)\}`/)
  assert.doesNotMatch(client, /await refreshUnreadSummary\(\)[\s\S]*mergeServerNotifications/)
  assert.doesNotMatch(client, /window\.addEventListener\('unread-summary:refresh'/)
  assert.doesNotMatch(client, /router\.refresh\(\)/)
  assert.match(client, /new AbortController\(\)/)
  assert.match(client, /signal: controller\.signal/)
  assert.match(client, /const requestKey = `\$\{currentPage\}:\$\{activeCategory\}`/)
  assert.match(client, /searchParamsStringRef\.current/)
  assert.match(provider, /new RealtimeClient/)
  assert.match(provider, /window\.addEventListener\('unread-summary:refresh', onLocalRefresh\)/)
})

test('unread-summary aggregates personal notifications without loading the unread rows', () => {
  const notifications = read('lib/notifications.ts')
  const summaryStart = notifications.indexOf('async function loadUnreadSummary')
  const summaryEnd = notifications.indexOf('export async function getUnreadNotificationCount')
  assert.ok(summaryStart >= 0)
  assert.ok(summaryEnd > summaryStart)
  const summary = notifications.slice(summaryStart, summaryEnd)

  assert.match(summary, /\$queryRaw/)
  assert.match(summary, /COUNT\(CASE WHEN/)
  assert.doesNotMatch(summary, /prisma\.notification\.findMany\(/)
  assert.doesNotMatch(summary, /reconcileStalePersonalNotifications\(/)
  assert.match(notifications, /unreadSummaryInFlight/)
})

test('notification actions update local list and summary without forcing a router refresh', () => {
  const client = read('app/notifications/NotificationsClient.tsx')

  assert.match(client, /setNotifications\(\(current\) => current\.map/)
  assert.match(client, /await refreshUnreadSummary\(\)/)
  assert.doesNotMatch(client, /router\.refresh\(\)/)
})
