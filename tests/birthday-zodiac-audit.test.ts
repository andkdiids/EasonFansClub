import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBirthdayZodiacAuditReport } from '@/scripts/audit-birthday-zodiac-badges'

test('birthday zodiac audit is read-only and identifies incorrect ownership states', () => {
  const users = [
    { id: 'u-leo', uid: 1001, createdAt: new Date('2025-01-01T00:00:00.000Z'), birthMonth: 8, birthDay: 8 },
    { id: 'u-virgo', uid: 1002, createdAt: new Date('2025-01-02T00:00:00.000Z'), birthMonth: 9, birthDay: 1 },
  ]
  const badges = [
    { id: 'b-leo', name: '狮子座', slug: 'leo', BadgeRule: { id: 'r-leo', configJson: { zodiac: 'LEO' } } },
    { id: 'b-virgo', name: '处女座', slug: 'virgo', BadgeRule: { id: 'r-virgo', configJson: { zodiac: 'VIRGO' } } },
  ]
  const userBadges = [
    {
      userId: 'u-leo', badgeId: 'b-leo', status: 'REVOKED', awardedAt: new Date('2025-01-03T00:00:00.000Z'),
      expiresAt: null, revokedAt: new Date('2026-09-01T00:00:00.000Z'), sourceType: 'AUTO_RULE', sourceId: 'r-leo',
    },
    {
      userId: 'u-virgo', badgeId: 'b-leo', status: 'ACTIVE', awardedAt: new Date('2025-01-03T00:00:00.000Z'),
      expiresAt: null, revokedAt: null, sourceType: 'AUTO_RULE', sourceId: 'r-leo',
    },
  ]

  const report = buildBirthdayZodiacAuditReport(users, badges, userBadges, new Date('2026-09-10T00:00:00.000Z'))

  assert.equal(report.productionDataMutated, false)
  assert.equal(report.totalUsersWithBirthday, 2)
  assert.equal(report.incorrectlyRevoked.count, 1)
  assert.equal(report.falseRevokeCount, 1)
  assert.equal(report.wrongActiveZodiac.count, 1)
  assert.equal(report.staleBirthdayMismatch.count, 1)
  assert.equal(report.missingCorrectZodiac.count, 1)
  assert.equal(report.multipleActiveZodiacs.count, 0)
})

test('09-02 Virgo users with revoked Leo history remain Virgo preview candidates', () => {
  const report = buildBirthdayZodiacAuditReport([
    { id: 'u-0902', uid: 1003, createdAt: new Date('2025-01-03T00:00:00.000Z'), birthMonth: 9, birthDay: 2 },
  ], [
    { id: 'b-leo', name: '狮子座', slug: 'leo', BadgeRule: { id: 'r-leo', configJson: { zodiac: 'LEO' } } },
    { id: 'b-virgo', name: '处女座', slug: 'virgo', BadgeRule: { id: 'r-virgo', configJson: { zodiac: 'VIRGO' } } },
  ], [
    {
      userId: 'u-0902', badgeId: 'b-leo', status: 'REVOKED', awardedAt: new Date('2026-08-01T00:00:00.000Z'),
      expiresAt: null, revokedAt: new Date('2026-09-08T00:00:00.000Z'), sourceType: 'AUTO_RULE', sourceId: 'r-leo', revokeReason: 'INCIDENT_INVALID_ZODIAC_PERIOD_GRANT',
    },
  ], new Date('2026-09-10T00:00:00.000Z'))

  assert.equal(report.currentPeriodZodiac, 'VIRGO')
  assert.equal(report.virgoMissingGrantAudit.totalUsersBirthdayResolvesVirgo, 1)
  assert.equal(report.virgoMissingGrantAudit.activeVirgoOwnership, 0)
  assert.equal(report.virgoMissingGrantAudit.missingButEligible, 1)
  assert.equal(report.virgoMissingGrantAudit.blockedByOtherZodiacHistory, 0)
  assert.equal(report.virgoMissingGrantAudit.blockedByLeoHistory, 0)
  assert.equal(report.crossZodiacAudit.crossZodiacBlockCount, 0)
  assert.equal(report.virgoMissingGrantAudit.samples[0]?.uid, 1003)
})
