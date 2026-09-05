import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateBadgeExpiresAt, isUserBadgeActive, normalizeBadgeValidity, remainingBadgeDays } from '@/lib/badge-validity'

const read = (path: string) => readFileSync(path, 'utf8')
const schema = read('prisma/schema.prisma')
const userBadgeModel = schema.slice(schema.indexOf('model UserBadge'), schema.indexOf('model UserBadgeShowcase'))
const migration = read('prisma/migrations/20260905090000_add_badge_validity_and_grant_history/migration.sql')

test('PERMANENT Badge has no expiry and custom validity accepts arbitrary positive days', () => {
  assert.deepEqual(normalizeBadgeValidity('PERMANENT', null), { validityType: 'PERMANENT', validityDays: null })
  assert.deepEqual(normalizeBadgeValidity('DAYS', '37'), { validityType: 'DAYS', validityDays: 37 })
  assert.equal(calculateBadgeExpiresAt(new Date('2026-09-01T12:34:56.000Z'), 'PERMANENT', null), null)
})

test('30-day validity snapshots expiresAt from the exact awarded time', () => {
  const awardedAt = new Date('2026-09-01T12:34:56.000Z')
  assert.equal(calculateBadgeExpiresAt(awardedAt, 'DAYS', 30)?.toISOString(), '2026-10-01T12:34:56.000Z')
})

test('invalid validity days are rejected before a grant can be created', () => {
  for (const value of [null, undefined, '', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1.5']) {
    assert.throws(() => normalizeBadgeValidity('DAYS', value), RangeError)
  }
})

test('runtime expiration fallback requires ACTIVE and a future expiresAt', () => {
  const now = new Date('2026-10-01T12:34:56.000Z')
  assert.equal(isUserBadgeActive({ status: 'ACTIVE', expiresAt: '2026-10-01T12:34:56.001Z' }, now), true)
  assert.equal(isUserBadgeActive({ status: 'ACTIVE', expiresAt: now }, now), false)
  assert.equal(isUserBadgeActive({ status: 'ACTIVE', expiresAt: '2026-09-30T12:34:56.000Z' }, now), false)
  assert.equal(isUserBadgeActive({ status: 'EXPIRED', expiresAt: null }, now), false)
  assert.equal(isUserBadgeActive({ status: 'REVOKED', expiresAt: null }, now), false)
  assert.equal(remainingBadgeDays('2026-10-04T12:34:56.000Z', now), 3)
})

test('UserBadge stores repeatable history, status, snapshot and nullable current/idempotency keys', () => {
  for (const field of ['awardedAt', 'expiresAt', 'expiredAt', 'revokedAt', 'status', 'activeKey', 'grantKey', 'sourceType', 'sourceId', 'grantReason']) {
    assert.match(userBadgeModel, new RegExp(`\\b${field}\\b`))
  }
  assert.match(userBadgeModel, /status\s+UserBadgeStatus\s+@default\(ACTIVE\)/)
  assert.match(userBadgeModel, /activeKey\s+String\?\s+@unique/)
  assert.match(userBadgeModel, /grantKey\s+String\?\s+@unique/)
  assert.doesNotMatch(userBadgeModel, /@@unique\(\[userId,\s*badgeId\]\)/)
})

test('new Badge records default to permanent and migration preserves existing grants', () => {
  assert.match(schema, /validityType\s+BadgeValidityType\s+@default\(PERMANENT\)/)
  assert.match(schema, /validityDays\s+Int\?/) 
  assert.match(migration, /ADD COLUMN `validityType` ENUM\('PERMANENT', 'DAYS'\) NOT NULL DEFAULT 'PERMANENT'/)
  assert.match(migration, /ADD COLUMN `validityDays` INTEGER NULL/)
  assert.match(migration, /UPDATE `UserBadge`[\s\S]*?`status` = 'ACTIVE'[\s\S]*?`activeKey` = SHA2/)
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE/i)
})

test('central grant service snapshots Badge validity and permits re-grant after inactive history', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /calculateBadgeExpiresAt\(awardedAt, badge\.validityType, badge\.validityDays\)/)
  assert.match(service, /awardedAt,\s*\n\s*expiresAt,\s*\n\s*expiredAt/)
  assert.match(service, /activeUserBadgeWhere\(\)/)
  assert.match(service, /tx\.userBadge\.create\(/)
  assert.match(service, /status === 'ACTIVE' \? activeBadgeKey/) 
})

test('automatic expiration marks rows EXPIRED, preserves history and clears stale equipment/showcase', () => {
  const expiration = read('lib/badge-expiration.ts')
  assert.match(expiration, /export async function expireUserBadges/)
  assert.match(expiration, /status: 'ACTIVE', expiresAt: \{ not: null, lte: now \}/)
  assert.match(expiration, /status: 'EXPIRED', expiredAt: now, activeKey: null/)
  assert.match(expiration, /equippedBadgeId: row\.badgeId.*data: \{ equippedBadgeId: null \}/)
  assert.match(expiration, /userBadgeShowcase\.deleteMany/)
})

test('daily scheduler invokes the unified expiration task before reward scans', () => {
  const birthday = read('lib/birthday.ts')
  assert.match(birthday, /import \{ expireUserBadges \} from '@\/lib\/badge-expiration'/)
  assert.match(birthday, /grantTodayBirthdayRewards[\s\S]*?await expireUserBadges\(\)/)
  const server = read('server.ts')
  assert.match(server, /import\('\.\/lib\/badge-expiration'\)/)
  assert.match(server, /expireUserBadges\(\)/)
  const activityJob = read('app/api/internal/daily-jobs/activity-auto-checkin/route.ts')
  assert.match(activityJob, /import \{ expireUserBadges \} from '@\/lib\/badge-expiration'/)
  assert.match(activityJob, /expireUserBadges\(\)/)
})

test('expired history can be earned again while an active grant is blocked', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /where: \{ userId: input\.userId, badgeId: input\.badgeId, \.\.\.activeUserBadgeWhere\(now\) \}/)
  assert.match(service, /if \(active\) \{[\s\S]*?operationResult\(input, badge\.name, active\.id\)/)
  assert.match(service, /const record = await tx\.userBadge\.create\(/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /key=\{item\.recordId\}/)
})

test('event grants require a new event key and periodic grants use a new period key', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /eventKey = eventId\?\.trim\(\) \? `event:\$\{eventType\}:\$\{eventId\.trim\(\)\}`/)
  assert.match(engine, /grantKey: grantKeyForRule\(rule, now, grantKeyPrefix\)/)
  assert.match(engine, /account-age:\$\{rule\.id\}:\$\{rule\.threshold \?\? 'none'\}/)
  assert.match(engine, /birthday:\$\{getShanghaiDateKey\(now\)\}/)
  assert.match(engine, /zodiac:\$\{getZodiacPeriodKey\(now, 'Asia\/Shanghai'\)/)
  assert.match(read('lib/birthday.ts'), /grantKey: `birthday:\$\{dateKey\}`/)
  assert.match(read('lib/zodiac.ts'), /getZodiacPeriodKey/)
})

test('automatic event callers pass stable source event identities', () => {
  assert.match(read('app/api/posts/route.ts'), /triggerBadgeEvaluation\(user\.id, 'POST_CREATED', result\.post\.id\)/)
  assert.match(read('app/api/checkin/route.ts'), /triggerBadgeEvaluation\(input\.userId, 'CHECKIN_CREATED', input\.requestId\)/)
  assert.match(read('lib/guess-song-session.ts'), /triggerBadgeEvaluation\(input\.userId, 'GUESS_SONG_SESSION_FINISHED', input\.sessionId\)/)
  assert.match(read('lib/concert-badge.ts'), /grantKey: `concert:\$\{award\.sourceType\}:\$\{award\.sourceId\}`/)
})

test('revoke is distinct from natural expiration and never deletes UserBadge history', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /status: 'REVOKED', revokedAt: new Date\(\), activeKey: null/)
  assert.doesNotMatch(service, /userBadge\.delete\(/)
  assert.match(service, /userBadgeShowcase\.deleteMany\(\{ where: \{ userId, badgeId \} \}\)/)
})

test('changing Badge validity is a future-grant setting, not a historical rewrite', () => {
  const admin = read('app/api/admin/badges/[badgeId]/route.ts')
  const service = read('lib/badge-service.ts')
  assert.match(admin, /normalizeBadgeValidity\(/)
  assert.match(service, /validityType: true, validityDays: true/)
  assert.match(service, /const expiresAt = calculateBadgeExpiresAt\(/)
  assert.doesNotMatch(admin, /userBadge\.updateMany|userBadge\.update\(/)
})

test('admin UI exposes validity setting and manual grant expiry preview', () => {
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  const grantRoute = read('app/api/admin/badges/[badgeId]/grant/route.ts')
  assert.match(manager, /有效期/)
  assert.match(manager, /value=\{draft\.validityType\}/)
  assert.match(manager, /value="DAYS"/) 
  assert.match(manager, /有效天数/)
  assert.match(manager, /修改此设置不会改变已经发放的勋章/)
  assert.match(manager, /预计失效/)
  assert.match(grantRoute, /previewExpiresAt: calculateBadgeExpiresAt\(/)
})

test('current badge display excludes expired grants and history displays each record', () => {
  const service = read('lib/badge-service.ts')
  const panel = read('components/BadgeCollectionPanel.tsx')
  assert.match(service, /where: \{ userId, \.\.\.activeUserBadgeWhere\(now\)/)
  assert.match(service, /history: historyRecords\.map\(badgeHistoryView\)/)
  assert.match(panel, /历史获得/)
  assert.match(panel, /已过期/)
  assert.match(panel, /有效至：/)
  assert.match(panel, /item\.recordId/)
})

test('dynamic acquisition resolver remains compositional and raw acquisition text is not overwritten', () => {
  const acquisition = read('lib/badge-acquisition.ts')
  const service = read('lib/badge-service.ts')
  assert.match(acquisition, /resolveBadgeAcquisitionDescription/)
  assert.match(acquisition, /originalLines.*filter.*ANGEL_GIFT_BADGE_ACQUISITION_TEXT/)
  assert.match(service, /resolvedAcquisitionForBadge/)
  assert.doesNotMatch(service, /Badge\.acquisitionDescription\s*=/)
  assert.match(read('app/admin/badges/BadgeAdminManager.tsx'), /resolvedAcquisitionDescription/)
})

test('concurrent grants are serialized and defended by unique active and grant keys', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /SELECT id FROM .*User.*FOR UPDATE/)
  assert.match(service, /error instanceof Prisma\.PrismaClientKnownRequestError && error\.code === 'P2002'/)
  assert.match(userBadgeModel, /activeKey\s+String\?\s+@unique/)
  assert.match(userBadgeModel, /grantKey\s+String\?\s+@unique/)
  assert.match(migration, /CREATE UNIQUE INDEX `UserBadge_activeKey_key`/)
  assert.match(migration, /CREATE UNIQUE INDEX `UserBadge_grantKey_key`/)
})
