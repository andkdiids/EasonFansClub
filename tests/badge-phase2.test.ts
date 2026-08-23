import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateBadgeProgress, formatBadgeOwnershipRate, getBadgeAvailability, parseBadgeAvailabilityDate, validateBadgeAvailability } from '@/lib/badge-phase2'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { parseBadgeSeriesInput } from '@/lib/badge-series'

const read = (path: string) => readFileSync(path, 'utf8')

test('Phase 2 schema defines BadgeSeries and administrator-sortable fields', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model BadgeSeries\s*\{[\s\S]*code\s+String\s+@unique[\s\S]*sortOrder\s+Int[\s\S]*isEnabled\s+Boolean/)
  assert.match(schema, /seriesId\s+String\?/)
  assert.match(schema, /tierGroupCode\s+String\?/)
  assert.match(schema, /availableFrom\s+DateTime\?/)
  assert.match(schema, /availableUntil\s+DateTime\?/)
})

test('BadgeSeries deletion is SET NULL and never deletes Badge rows', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260822160000_add_badge_phase2_collection_system/migration.sql')
  assert.match(schema, /Series\s+BadgeSeries\?\s+@relation\(fields: \[seriesId\], references: \[id\], onDelete: SetNull\)/)
  assert.match(migration, /Badge_seriesId_fkey[\s\S]*ON DELETE SET NULL/)
  assert.doesNotMatch(migration, /DELETE FROM `Badge`|DROP TABLE `Badge`|TRUNCATE/i)
})

test('Phase 2 migration follows the Phase 1 rule migration', () => {
  assert.ok('20260822160000_add_badge_phase2_collection_system' > '20260822100000_add_badge_auto_rules')
})

test('tier group and level have a database uniqueness guard', () => {
  assert.match(read('prisma/schema.prisma'), /@@unique\(\[tierGroupCode, tierLevel\]\)/)
  assert.match(read('prisma/migrations/20260822160000_add_badge_phase2_collection_system/migration.sql'), /Badge_tierGroupCode_tierLevel_key/)
  assert.match(read('prisma/schema.prisma'), /tierGroupCode\s+String\?/)
  assert.match(read('prisma/schema.prisma'), /tierLevel\s+Int\?/)
})

test('legacy badges can remain without a series or tier', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /seriesId\s+String\?/)
  assert.match(schema, /tierGroupCode\s+String\?/)
  assert.match(schema, /tierLevel\s+Int\?/)
})

test('permanent availability is stable', () => {
  assert.equal(getBadgeAvailability({ availableFrom: null, availableUntil: null }, new Date('2026-08-22T00:00:00+08:00')), 'PERMANENT')
})

test('upcoming availability is server-time based', () => {
  assert.equal(getBadgeAvailability({ availableFrom: new Date('2026-08-23T00:00:00+08:00'), availableUntil: null }, new Date('2026-08-22T23:59:59+08:00')), 'UPCOMING')
})

test('available limited badge is grantable inside the window', () => {
  assert.equal(getBadgeAvailability({ availableFrom: new Date('2026-08-01T00:00:00+08:00'), availableUntil: new Date('2026-08-31T23:59:59+08:00') }, new Date('2026-08-22T12:00:00+08:00')), 'AVAILABLE')
})

test('ended limited badge is collectible but no longer grantable', () => {
  assert.equal(getBadgeAvailability({ availableFrom: null, availableUntil: new Date('2026-08-21T23:59:59+08:00') }, new Date('2026-08-22T00:00:00+08:00')), 'ENDED')
  assert.match(read('lib/badge-service.ts'), /BADGE_NOT_AVAILABLE/)
})

test('availability parser uses Shanghai time for datetime-local values', () => {
  const parsed = parseBadgeAvailabilityDate('2026-08-22T12:30', '限定开始时间')
  assert.ok(parsed.value)
  assert.equal(parsed.value?.toISOString(), '2026-08-22T04:30:00.000Z')
})

test('invalid availability ordering is rejected', () => {
  assert.equal(validateBadgeAvailability(new Date('2026-08-23T00:00:00+08:00'), new Date('2026-08-22T00:00:00+08:00')), '限定开始时间不能晚于结束时间')
  assert.equal(validateBadgeAvailability(new Date('2026-08-22T00:00:00+08:00'), new Date('2026-08-22T00:00:00+08:00')), null)
})

test('GTE progress calculates 63/100 as 63 percent', () => {
  assert.deepEqual(calculateBadgeProgress(63, 'GTE', 100), { current: 63, target: 100, percentage: 63, operator: 'GTE' })
})

test('progress is capped at 100 percent', () => {
  assert.equal(calculateBadgeProgress(163, 'GTE', 100).percentage, 100)
})

test('progress never goes below zero', () => {
  assert.equal(calculateBadgeProgress(-4, 'GTE', 100).percentage, 0)
})

test('LTE progress is explicitly unsupported rather than misleading', () => {
  assert.equal(calculateBadgeProgress(3, 'LTE', 10).progressUnsupported, true)
})

test('EQ progress is explicitly unsupported rather than misleading', () => {
  assert.equal(calculateBadgeProgress(3, 'EQ', 3).progressUnsupported, true)
})

test('zero-user ownership rate does not divide by zero', () => {
  assert.deepEqual(formatBadgeOwnershipRate(0, 0), { rate: 0, display: '0%' })
})

test('very rare ownership never displays a misleading 0.0 percent', () => {
  assert.equal(formatBadgeOwnershipRate(1, 10427).display, '<0.1%')
})

test('ownership rate keeps one decimal place for normal public statistics', () => {
  assert.equal(formatBadgeOwnershipRate(27, 1000).display, '2.7%')
})

test('ownership statistics use active non-deleted users', () => {
  assert.match(read('lib/badge-phase2.ts'), /User: \{ status: 'ACTIVE', isDeleted: false \}/)
  assert.match(read('lib/badge-phase2.ts'), /prisma\.user\.count\(\{ where: \{ status: 'ACTIVE', isDeleted: false \} \}\)/)
})

test('ownership statistics are grouped by badge instead of one count per card', () => {
  assert.match(read('lib/badge-phase2.ts'), /userBadge\.groupBy\(/)
  assert.match(read('lib/badge-phase2.ts'), /by: \['badgeId'\]/)
})

test('collection uses one memoized metric per rule type', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /const metrics = new Map<string, number>\(\)/)
  assert.match(service, /if \(!metrics\.has\(type\)\)/)
})

test('public collection redacts HIDDEN progress and metadata', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /function hiddenBadgeView[\s\S]*progress: null[\s\S]*ownershipStats: null/)
  assert.ok(service.includes("name: '???'"))
})

test('SECRET badges are omitted from another user’s collection', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /const visibleRecords = isSelf \? records : records\.filter\(\(record\) => record\.Badge\.visibility !== 'SECRET'\)/)
  assert.match(service, /if \(badge\.visibility === 'SECRET'\) return \[\]/)
})

test('SECRET badges are excluded from the public denominator', () => {
  assert.match(read('lib/badge-service.ts'), /visibility !== 'SECRET'/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /publicTotal/)
})

test('only PUBLIC auto rules receive detailed progress', () => {
  assert.match(read('lib/badge-service.ts'), /visibility === 'PUBLIC' && badge\.grantType === 'AUTO'/)
  assert.match(read('lib/badge-service.ts'), /BadgeRule\?\.isEnabled/)
})

test('availability is evaluated on the server for rule scans', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /badgeAvailabilityWhere\(now\)/)
  assert.match(read('lib/badge-phase2.ts'), /browser never decides whether a grant is legal/)
})

test('disabled badges are rejected by the central grant service', () => {
  assert.match(read('lib/badge-service.ts'), /if \(!badge\.isEnabled \|\| !badge\.isActive\) throw new BadgeServiceError\('BADGE_DISABLED'/)
})

test('limited badge backfill refuses to guess historical attainment time', () => {
  assert.match(read('lib/badge-rule-engine.ts'), /限定勋章没有可靠的历史达标时间，不能使用自动历史补发/)
})

test('backfill stays within the 100 to 500 batch limit', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /BACKFILL_BATCH_MIN = 100/)
  assert.match(engine, /BACKFILL_BATCH_MAX = 500/)
})

test('rule preview does not grant badges', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const preview = engine.slice(engine.indexOf('export async function previewBadgeRule'))
  assert.doesNotMatch(preview, /grantBadge\(/)
  assert.match(preview, /eligibleCount/)
})

test('rule preview reads bounded user pages', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const preview = engine.slice(engine.indexOf('export async function previewBadgeRule'))
  assert.match(preview, /take: BACKFILL_BATCH_MAX/)
  assert.match(preview, /getBatchBadgeMetrics\(users, type, badge\.BadgeRule\.configJson\)/)
  assert.match(preview, /eligibleIds\.length - ownedEligibleCount/)
  assert.doesNotMatch(preview, /pendingCount: Math\.max\(0, eligibleCount - ownedCount\)/)
})

test('series management is protected by achievement_manage', () => {
  assert.match(read('app/api/admin/badges/series/route.ts'), /requireAdmin\('achievement_manage'\)/)
  assert.match(read('app/api/admin/badges/series/[seriesId]/route.ts'), /requireAdmin\('achievement_manage'\)/)
})

test('series delete only ungroups badges', () => {
  const service = read('lib/badge-series.ts')
  assert.match(service, /updateMany\(\{ where: \{ seriesId: input\.seriesId \}, data: \{ seriesId: null \} \}\)/)
  assert.doesNotMatch(service, /tx\.userBadge\.delete|DELETE FROM `UserBadge`/)
})

test('series parser only requires a business name and keeps code internal', () => {
  assert.ok(parseBadgeSeriesInput({ name: '社区' }).data)
  assert.match(read('lib/badge-series.ts'), /randomUUID/)
})

test('tier parser requires a positive bounded level', () => {
  assert.match(String(parseBadgeDefinition({ name: 'A', grantType: 'MANUAL', tierEnabled: true, tierLevel: 0 }).error), /阶段/)
  assert.equal(parseBadgeDefinition({ name: 'A', grantType: 'MANUAL', tierEnabled: true, tierLevel: 2 }).error, undefined)
})

test('legacy AUTO badges without BadgeRule remain editable', () => {
  const route = read('app/api/admin/badges/[badgeId]/route.ts')
  assert.match(route, /keepsLegacyAutoFlow/)
  assert.match(route, /previous\.grantType === 'AUTO'/)
})

test('EVENT and MANUAL badges do not become rule-engine candidates', () => {
  assert.match(read('lib/badge-rule-engine.ts'), /grantType: 'AUTO'/)
  assert.match(read('lib/badge-admin.ts'), /手动或事件勋章不能配置自动获取规则/)
})

test('all automatic grants still pass through grantBadge', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /grantBadge\(/)
  assert.doesNotMatch(engine, /userBadge\.create\(/)
})

test('changing a rule does not revoke historical UserBadge records', () => {
  const route = read('app/api/admin/badges/[badgeId]/route.ts')
  assert.doesNotMatch(route, /revokeBadge\(/)
  assert.match(route, /规则修改不会撤销|effectiveRule|BadgeRule/)
})

test('automatic evaluation keeps failures out of the primary request', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /void evaluateBadgesForEvent\(userId, eventType\)\.catch/)
})

test('rule events are narrowed through the controlled registry', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /EVENT_RULE_TYPES\[eventType\]/)
  assert.match(engine, /BADGE_RULE_REGISTRY\[ruleType\]\.events/)
})

test('collection exposes series and tier metadata without a second achievement relation', () => {
  assert.match(read('lib/badge-types.ts'), /BadgeSeriesView/)
  assert.match(read('lib/badge-types.ts'), /tierGroupCode\?: string \| null/)
  assert.doesNotMatch(read('prisma/schema.prisma'), /TierRule/)
})

test('collection supports limited, progress and hidden tabs', () => {
  const panel = read('components/BadgeCollectionPanel.tsx')
  for (const value of ['进行中', '限定', '隐藏']) assert.match(panel, new RegExp(value))
})

test('obtained badges show history instead of live progress', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /if \(record\) return \[obtainedBadgeView/)
  assert.match(service, /status: 'OBTAINED'/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /获得于/)
})

test('expired badges remain visible and wearable when already owned', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /availabilityStatus: getBadgeAvailability\(badge\)/)
  assert.match(service, /if \(!record\.Badge\.isEnabled \|\| !record\.Badge\.isActive\)/)
  assert.doesNotMatch(service, /getBadgeAvailability\(record\.Badge\).*BADGE_NOT_WEARABLE/)
})

test('equippedBadgeId remains the single wearable relation', () => {
  assert.match(read('prisma/schema.prisma'), /equippedBadgeId\s+String\?/)
  assert.doesNotMatch(read('prisma/schema.prisma'), /equippedBadgeIds|equippedTier/)
})

test('high-frequency equipped badge lookups use the minimal presentation select', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /const EQUIPPED_BADGE_SELECT = \{[\s\S]*isActive: true,[\s\S]*\} as const/)
  assert.match(service, /EquippedBadge: \{ select: EQUIPPED_BADGE_SELECT \}/)
  const start = service.indexOf('export async function getEquippedBadgesForUsers')
  const end = service.indexOf('export async function grantBadge', start)
  assert.doesNotMatch(service.slice(start, end), /Series:/)
})

test('admin rule preview is wired to the achievement permission', () => {
  assert.match(read('app/api/admin/badges/[badgeId]/preview/route.ts'), /requireAdmin\('achievement_manage'\)/)
  assert.match(read('app/admin/badges/BadgeAdminManager.tsx'), /预览达标/)
})

test('admin supports Shanghai limited-date inputs', () => {
  assert.match(read('app/admin/badges/BadgeAdminManager.tsx'), /datetime-local/)
  assert.match(read('app/admin/badges/BadgeAdminManager.tsx'), /Asia\/Shanghai/)
})

test('admin filters series, rarity and availability on the server', () => {
  const service = read('lib/badge-service.ts')
  for (const field of ['rarity', 'seriesId', 'availability']) assert.match(service, new RegExp(field))
})

test('migration does not alter the deployed Phase 1 migrations', () => {
  const changed = read('prisma/migrations/20260822160000_add_badge_phase2_collection_system/migration.sql')
  assert.match(changed, /仅增加可空\/默认字段与新表/)
  assert.doesNotMatch(changed, /20260821153000|20260822100000/)
})
