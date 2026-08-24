import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateBadgeRuleProgress, canExposeLiveBadgeProgress, isBadgeProgressRule } from '@/lib/badge-phase2'

const read = (path: string) => readFileSync(path, 'utf8')

test('detail progress uses the registry unit for cumulative check-in days', () => {
  const progress = calculateBadgeRuleProgress(143, { ruleType: 'CHECKIN_TOTAL_DAYS', operator: 'GTE', threshold: 365, isEnabled: true })
  assert.deepEqual(progress, { current: 143, target: 365, percentage: 39, operator: 'GTE', unitLabel: '天' })
})

test('detail progress keeps consecutive check-in days distinct from cumulative days', () => {
  const progress = calculateBadgeRuleProgress(18, { ruleType: 'CHECKIN_STREAK', operator: 'GTE', threshold: 30, isEnabled: true })
  assert.equal(progress?.current, 18)
  assert.equal(progress?.target, 30)
  assert.equal(progress?.unitLabel, '天')
})

test('all numeric GTE registry rules expose progress while special rules do not', () => {
  for (const ruleType of ['POST_COUNT', 'FEATURED_POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'CHECKIN_STREAK', 'ACCOUNT_AGE_DAYS', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'GUESS_SONG_MAX_STREAK', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'RATING_COUNT']) {
    assert.equal(isBadgeProgressRule({ ruleType, operator: 'GTE', threshold: 10, isEnabled: true }), true, ruleType)
  }
  for (const rule of [
    { ruleType: 'BADGE_SERIES_COMPLETE', operator: 'GTE', threshold: 1, isEnabled: true },
    { ruleType: 'CONCERT_SHOW_ATTENDED', operator: 'GTE', threshold: null, isEnabled: true },
    { ruleType: 'POST_COUNT', operator: 'LTE', threshold: 10, isEnabled: true },
    { ruleType: 'POST_COUNT', operator: 'GTE', threshold: null, isEnabled: true },
    { ruleType: 'POST_COUNT', operator: 'GTE', threshold: 10, isEnabled: false },
  ]) assert.equal(isBadgeProgressRule(rule), false)
})

test('detail progress keeps the real current value and clamps only the bar percentage', () => {
  const progress = calculateBadgeRuleProgress(420, { ruleType: 'CHECKIN_TOTAL_DAYS', operator: 'GTE', threshold: 365, isEnabled: true })
  assert.equal(progress?.current, 420)
  assert.equal(progress?.percentage, 100)
})

test('live detail progress is limited to public enabled AUTO badges in an active window', () => {
  const base = {
    visibility: 'PUBLIC',
    grantType: 'AUTO',
    isEnabled: true,
    isActive: true,
    availableFrom: null,
    availableUntil: null,
    BadgeRule: { ruleType: 'CHECKIN_TOTAL_DAYS', operator: 'GTE', threshold: 10, isEnabled: true },
  } as const
  const now = new Date('2026-08-24T12:00:00+08:00')
  assert.equal(canExposeLiveBadgeProgress(base, now), true)
  assert.equal(canExposeLiveBadgeProgress({ ...base, grantType: 'MANUAL' }, now), false)
  assert.equal(canExposeLiveBadgeProgress({ ...base, visibility: 'HIDDEN' }, now), false)
  assert.equal(canExposeLiveBadgeProgress({ ...base, isEnabled: false }, now), false)
  assert.equal(canExposeLiveBadgeProgress({ ...base, BadgeRule: null }, now), false)
  assert.equal(canExposeLiveBadgeProgress({ ...base, BadgeRule: { ...base.BadgeRule, operator: 'LTE' } }, now), false)
  assert.equal(canExposeLiveBadgeProgress({ ...base, availableFrom: new Date('2026-08-25T00:00:00+08:00') }, now), false)
  assert.equal(canExposeLiveBadgeProgress({ ...base, availableUntil: new Date('2026-08-24T12:00:00+08:00') }, now), false)
})

test('check-in progress keeps total-day and current-streak metrics on the existing Shanghai date-key loaders', () => {
  const metrics = read('lib/badge-metrics.ts')
  assert.match(metrics, /CHECKIN_TOTAL_DAYS:[\s\S]*checkinDateKey[\s\S]*new Set/)
  assert.match(metrics, /CHECKIN_STREAK:[\s\S]*checkinDateKey[\s\S]*calculateCheckinStreaks\([\s\S]*currentStreak/)
  assert.match(read('lib/badge-rules.ts'), /CHECKIN_TOTAL_DAYS:[\s\S]*unit: '天'[\s\S]*metricLoader: 'CHECKIN_TOTAL_DAYS'/)
  assert.match(read('lib/badge-rules.ts'), /CHECKIN_STREAK:[\s\S]*unit: '天'[\s\S]*metricLoader: 'CHECKIN_STREAK'/)
})

test('detail refresh is current-user-only, no-store and does not calculate metrics in the browser', () => {
  const route = read('app/api/users/me/badges/[badgeId]/route.ts')
  const component = read('components/BadgeCollectionPanel.tsx')
  assert.match(route, /getCurrentUser\(\)/)
  assert.match(route, /getBadgeDetailForUser\(viewer\.id, badgeId\)/)
  assert.match(route, /Cache-Control.*private, no-store/)
  assert.match(component, /\/api\/users\/me\/badges\/\$\{encodeURIComponent\(badge\.id\)\}/)
  assert.match(component, /cache: 'no-store'/)
  assert.doesNotMatch(component, /fetch\('\/api\/checkin\/history'/)
})

test('detail and Task Center use the shared rule progress builder', () => {
  const service = read('lib/badge-service.ts')
  const taskCenter = read('lib/badge-phase5.ts')
  assert.match(service, /calculateBadgeRuleProgress\(/)
  assert.match(service, /getUserBadgeRuleProgress\(/)
  assert.match(taskCenter, /calculateBadgeRuleProgress\(/)
  assert.doesNotMatch(taskCenter, /calculateBadgeProgress\(/)
})

test('detail refresh listens for the existing check-in update event', () => {
  const component = read('components/BadgeCollectionPanel.tsx')
  assert.match(component, /checkin:dayChanged/)
  assert.match(component, /visibilitychange/)
  assert.match(component, /window\.addEventListener\('focus'/)
  assert.match(component, /setDisplayBadge\(data\.badge\)/)
})

test('detail and Task Center share the server-side live eligibility gate', () => {
  const service = read('lib/badge-service.ts')
  const taskCenter = read('lib/badge-phase5.ts')
  assert.match(service, /canExposeLiveBadgeProgress\(badge\)/)
  assert.match(service, /item\?\.status === 'NOT_OBTAINED'/)
  assert.match(taskCenter, /canExposeLiveBadgeProgress\(badge, now\)/)
  assert.doesNotMatch(read('components/BadgeCollectionPanel.tsx'), /getUserBadgeMetric|calculateBadgeRuleProgress/)
})
