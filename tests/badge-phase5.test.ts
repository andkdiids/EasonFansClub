import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BADGE_MILESTONES, BADGE_RECOMMENDATION_LIMIT, highestBadgeMilestone, MAX_BADGE_TRACKING } from '@/lib/badge-phase5'

const read = (path: string) => readFileSync(path, 'utf8')

test('Phase 5 migration is additive and tracking ownership is unique', () => {
  const migration = read('prisma/migrations/20260824210000_add_badge_phase5_tasks/migration.sql')
  assert.match(migration, /ADD COLUMN `showBadgeProgressNotifications` BOOLEAN NOT NULL DEFAULT true/)
  assert.match(migration, /CREATE TABLE `UserBadgeTracking`/)
  assert.match(migration, /UNIQUE INDEX `UserBadgeTracking_userId_badgeId_key`/)
  assert.match(migration, /ON DELETE CASCADE/)
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE|UPDATE `Badge`|UPDATE `UserBadge`/i)
})

test('tracking is private, bounded, idempotent and validates trackable badges', () => {
  const source = read('lib/badge-phase5.ts')
  assert.equal(MAX_BADGE_TRACKING, 10)
  assert.match(source, /visibility !== 'PUBLIC'/)
  assert.match(source, /grantType !== 'AUTO'/)
  assert.match(source, /alreadyOwned|已经获得的勋章不需要追踪/)
  assert.match(source, /P2002/)
  assert.match(source, /userId_badgeId/)
  assert.doesNotMatch(read('app/api/users/me/badge-tasks/[badgeId]/route.ts'), /body.*userId|params.*userId/)
})

test('grant atomically removes completed tracking without touching equipment', () => {
  const source = read('lib/badge-service.ts')
  assert.match(source, /userBadgeTracking\.deleteMany\(\{ where: \{ userId: input\.userId, badgeId: input\.badgeId \} \}\)/)
  assert.doesNotMatch(read('lib/badge-phase5.ts'), /equippedBadgeId/)
})

test('milestones only emit the highest crossed threshold', () => {
  assert.deepEqual(BADGE_MILESTONES, [25, 50, 75, 90])
  assert.equal(highestBadgeMilestone(24), 0)
  assert.equal(highestBadgeMilestone(25), 25)
  assert.equal(highestBadgeMilestone(80), 75)
  assert.equal(highestBadgeMilestone(99), 90)
  const source = read('lib/badge-phase5.ts')
  assert.match(source, /percentage >= 100\) continue/)
  assert.match(source, /lastMilestone: \{ lt: milestone \}/)
  assert.match(source, /badge-progress:\$\{userId\}:\$\{row\.Badge\.id\}:\$\{milestone\}/)
})

test('progress preference suppresses milestones but not grant notifications', () => {
  const phase5 = read('lib/badge-phase5.ts')
  const phase3 = read('lib/badge-phase3.ts')
  assert.match(phase5, /showBadgeProgressNotifications/)
  assert.doesNotMatch(phase3, /showBadgeProgressNotifications/)
  assert.match(read('app/profile/ProfileSettingsForm.tsx'), /勋章进度提醒/)
})

test('recommendations are safe, available, stable and limited to three', () => {
  const source = read('lib/badge-phase5.ts')
  assert.equal(BADGE_RECOMMENDATION_LIMIT, 3)
  assert.match(source, /visibility: 'PUBLIC', grantType: 'AUTO'/)
  assert.match(source, /badgeAvailabilityWhere\(now\)/)
  assert.match(source, /UserBadge: \{ none: \{ userId \} \}/)
  assert.match(source, /UserBadgeTracking: \{ none: \{ userId \} \}/)
  assert.match(source, /dailyTieBreaker/)
  assert.match(source, /slice\(0, BADGE_RECOMMENDATION_LIMIT\)/)
})

test('task metrics are deduplicated by rule type', () => {
  const source = read('lib/badge-phase5.ts')
  assert.match(source, /new Set\(badges\.map/)
  assert.match(source, /Promise\.all\(types\.map/)
  assert.doesNotMatch(source, /badges\.map\(async[\s\S]*getUserBadgeMetric/)
})

test('year review is private, uses obtainedAt and Shanghai year boundaries', () => {
  const source = read('lib/badge-phase5.ts')
  assert.match(source, /T00:00:00\+08:00/)
  assert.match(source, /obtainedAt: \{ gte: start, lt: end \}/)
  assert.doesNotMatch(source, /Badge\.createdAt/)
  assert.match(read('app/api/users/me/badge-year-review/route.ts'), /requireUser/)
  assert.doesNotMatch(read('app/api/users/me/badge-year-review/route.ts'), /userId.*searchParams/)
})

test('analytics is achievement protected, aggregate-only and paginated', () => {
  const route = read('app/api/admin/badges/analytics/route.ts')
  const source = read('lib/badge-phase5.ts')
  assert.match(route, /requireAdmin\('achievement_manage'\)/)
  assert.match(route, /pageSize.*50/)
  assert.match(source, /groupBy\(\{ by: \['badgeId'\]/)
  assert.match(source, /skip: \(page - 1\) \* pageSize, take: pageSize/)
  assert.match(source, /COUNT\(\*\)[\s\S]*UserBadge/)
  assert.doesNotMatch(route, /owner.*email|phone|nickname/)
})

test('analytics preview batches users and metric signatures instead of badge N+1', () => {
  const source = read('lib/badge-phase5.ts')
  assert.match(source, /take: 500/)
  assert.match(source, /metricCache = new Map/)
  assert.match(source, /getBatchBadgeMetrics/)
  assert.match(source, /eligibleCount/)
  assert.match(source, /pendingCount/)
  assert.doesNotMatch(source, /previewBadges\.map\([\s\S]*previewBadgeRule/)
})

test('task center and year review are linked from the museum', () => {
  const museum = read('components/BadgeExhibitionHall.tsx')
  assert.match(museum, /href="\/badges\/tasks"/)
  assert.match(museum, /href="\/badges\/year-in-review"/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /加入任务/)
})

test('weekly push is intentionally absent without a reliable scheduler', () => {
  const source = read('lib/badge-phase5.ts')
  assert.doesNotMatch(source, /weeklyRecommendation|setInterval|cron/)
})
