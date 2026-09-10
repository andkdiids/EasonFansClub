import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildZodiacIncidentDryRun,
  type ZodiacIncidentSourceRow,
} from '@/scripts/repair-birthday-zodiac-incident'
import { isBirthdayAutomaticSourceRepairEligible } from '@/lib/badge-retention'

const incidentStart = new Date('2026-09-07T13:01:25.000Z')
const incidentEnd = new Date('2026-09-10T16:00:00.000Z')

function source(overrides: Partial<ZodiacIncidentSourceRow> = {}): ZodiacIncidentSourceRow {
  const userId = overrides.userId || 'u-1'
  const badgeId = overrides.badgeId || 'b-virgo'
  const sourceId = overrides.sourceId === undefined ? 'r-virgo' : overrides.sourceId
  return {
    id: overrides.id || `source-${userId}-${badgeId}`,
    userId,
    badgeId,
    userBadgeId: overrides.userBadgeId || `ub-${userId}-${badgeId}`,
    sourceType: overrides.sourceType || 'AUTO_RULE',
    sourceId,
    isActive: overrides.isActive ?? true,
    grantedAt: overrides.grantedAt || new Date('2026-09-10T04:00:00.000Z'),
    revokedAt: overrides.revokedAt || null,
    User: overrides.User || { id: userId, uid: 1001, birthMonth: 9, birthDay: 1 },
    Badge: overrides.Badge || { id: badgeId, name: '处女座', slug: 'virgo', BadgeRule: { id: sourceId || 'r-virgo', configJson: { zodiac: 'VIRGO' } } },
    UserBadge: overrides.UserBadge || {
      id: `ub-${userId}-${badgeId}`,
      status: 'ACTIVE',
      grantedAt: overrides.grantedAt || new Date('2026-09-10T04:00:00.000Z'),
      awardedAt: overrides.grantedAt || new Date('2026-09-10T04:00:00.000Z'),
      grantReason: '自动达成：星座',
      UserBadgeSource: [],
    },
  }
}

test('incident dry-run only classifies current-period auto grants as valid', () => {
  const result = buildZodiacIncidentDryRun({
    incidentStart,
    incidentEnd,
    sources: [
      source(),
      source({
        id: 'source-capricorn',
        userId: 'u-capricorn',
        badgeId: 'b-capricorn',
        sourceId: 'r-capricorn',
        User: { id: 'u-capricorn', uid: 1002, birthMonth: 12, birthDay: 25 },
        Badge: { id: 'b-capricorn', name: '摩羯座', slug: 'capricorn', BadgeRule: { id: 'r-capricorn', configJson: { zodiac: 'CAPRICORN' } } },
      }),
      source({
        id: 'source-manual',
        userId: 'u-manual',
        badgeId: 'b-capricorn',
        sourceType: 'ADMIN_GRANT',
        sourceId: 'manual-op',
        User: { id: 'u-manual', uid: 1003, birthMonth: 12, birthDay: 25 },
        Badge: { id: 'b-capricorn', name: '摩羯座', slug: 'capricorn', BadgeRule: { id: 'r-capricorn', configJson: { zodiac: 'CAPRICORN' } } },
      }),
    ],
  })

  assert.equal(result.report.totalGrantsInWindow, 3)
  assert.equal(result.report.validCurrentPeriodGrants, 1)
  assert.equal(result.report.falseFuturePreviousPeriodGrants, 1)
  assert.equal(result.report.manualGrants, 1)
  assert.equal(result.report.ownershipsToRevoke, 1)
  assert.equal(result.report.falseGrantsByZodiac.CAPRICORN, 1)
  assert.equal(result.revocable[0]?.userId, 'u-capricorn')
  assert.equal(result.report.productionMutated, false)
})

test('a prior legitimate permanent source is protected while only the incident source is revocable', () => {
  const leo = source({
    id: 'source-leo-incident',
    userId: 'u-leo',
    badgeId: 'b-leo',
    sourceId: 'r-leo',
    User: { id: 'u-leo', uid: 1004, birthMonth: 8, birthDay: 8 },
    Badge: { id: 'b-leo', name: '狮子座', slug: 'leo', BadgeRule: { id: 'r-leo', configJson: { zodiac: 'LEO' } } },
    UserBadge: {
      id: 'ub-u-leo-b-leo',
      status: 'ACTIVE',
      grantedAt: new Date('2026-08-10T04:00:00.000Z'),
      awardedAt: new Date('2026-08-10T04:00:00.000Z'),
      grantReason: '自动达成：星座',
      UserBadgeSource: [{
        id: 'source-leo-legitimate',
        sourceType: 'AUTO_RULE',
        sourceId: 'r-leo',
        isActive: true,
        grantedAt: new Date('2026-08-10T04:00:00.000Z'),
        revokedAt: null,
      }],
    },
  })
  const result = buildZodiacIncidentDryRun({ incidentStart, incidentEnd, sources: [leo] })
  assert.equal(result.report.falseFuturePreviousPeriodGrants, 1)
  assert.equal(result.report.legitimateHistoricalOwnershipProtected, 1)
  assert.equal(result.report.ownershipsToRevoke, 1)
  assert.equal(result.revocable[0]?.priorLegitimateOwnership, true)
})

test('missing source evidence and birthday changes are never auto-revoked', () => {
  const result = buildZodiacIncidentDryRun({
    incidentStart,
    incidentEnd,
    sources: [source({
      id: 'source-changed-birthday',
      userId: 'u-changed',
      badgeId: 'b-leo',
      sourceId: 'r-leo',
      User: { id: 'u-changed', uid: 1005, birthMonth: 9, birthDay: 1 },
      Badge: { id: 'b-leo', name: '狮子座', slug: 'leo', BadgeRule: { id: 'r-leo', configJson: { zodiac: 'LEO' } } },
    })],
    fallbackRows: [{
      id: 'ub-no-source',
      userId: 'u-no-source',
      badgeId: 'b-capricorn',
      status: 'ACTIVE',
      grantedAt: new Date('2026-09-10T04:00:00.000Z'),
      awardedAt: new Date('2026-09-10T04:00:00.000Z'),
      sourceType: null,
      sourceId: null,
      User: { id: 'u-no-source', uid: 1006, birthMonth: 12, birthDay: 25 },
      Badge: { id: 'b-capricorn', name: '摩羯座', slug: 'capricorn', BadgeRule: { id: 'r-capricorn', configJson: { zodiac: 'CAPRICORN' } } },
      UserBadgeSource: [],
    }],
  })
  assert.equal(result.report.falseFuturePreviousPeriodGrants, 0)
  assert.equal(result.report.ambiguousGrants, 2)
  assert.equal(result.report.ownershipsToRevoke, 0)
})

test('birthday zodiac repair uses the current-period grant resolver', () => {
  const now = new Date('2026-09-10T04:00:00.000Z')
  assert.equal(isBirthdayAutomaticSourceRepairEligible({
    ruleType: 'BIRTHDAY_ZODIAC',
    configJson: { zodiac: 'CAPRICORN' },
    birthMonth: 12,
    birthDay: 25,
    now,
  }), false)
  assert.equal(isBirthdayAutomaticSourceRepairEligible({
    ruleType: 'BIRTHDAY_ZODIAC',
    configJson: { zodiac: 'VIRGO' },
    birthMonth: 9,
    birthDay: 1,
    now,
  }), true)
})

test('birthday zodiac repair does not recreate a revoked source outside its period and preserves historical ownership semantics', () => {
  const now = new Date('2026-09-10T04:00:00.000Z')
  const leo = {
    ruleType: 'BIRTHDAY_ZODIAC' as const,
    configJson: { zodiac: 'LEO' },
    birthMonth: 8,
    birthDay: 8,
    now,
  }
  assert.equal(isBirthdayAutomaticSourceRepairEligible(leo), false)
  assert.equal(isBirthdayAutomaticSourceRepairEligible({
    ...leo,
    birthMonth: 9,
    birthDay: 1,
    configJson: { zodiac: 'VIRGO' },
  }), true)
  // A mixed ownership is protected by its valid historical source; the
  // repair gate must not recreate the invalid current-period source.
  assert.equal(isBirthdayAutomaticSourceRepairEligible(leo), false)
})

test('all birthday zodiac automatic paths share the repair gate and never use birthday-only matching', () => {
  const retention = readFileSync('lib/badge-retention.ts', 'utf8')
  const repairStart = retention.indexOf('async function repairBirthdayAutomaticSource')
  const repairEnd = retention.indexOf('\nasync function loadRevokeRuleContext', repairStart)
  const repair = retention.slice(repairStart, repairEnd)
  assert.match(repair, /isBirthdayAutomaticSourceRepairEligible\(/)
  assert.match(retention, /resolveZodiacGrantEligibility\(/)
  assert.doesNotMatch(repair, /if \(birthdayMatches\)[\s\S]*grantBadge/)
})
