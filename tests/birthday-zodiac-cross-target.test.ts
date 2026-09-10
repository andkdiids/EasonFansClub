import assert from 'node:assert/strict'
import test from 'node:test'
import { INCIDENT_INVALID_ZODIAC_PERIOD_GRANT } from '@/lib/badge-revocation'
import { resolveZodiacBadgeGrantEligibility, zodiacGrantKey } from '@/lib/birthday-zodiac-grant'

const now = new Date('2026-09-10T04:00:00.000Z')

function historyRow(badgeId: string, status: 'ACTIVE' | 'REVOKED', revokeReason: string | null = null) {
  return {
    badgeId,
    status,
    expiresAt: null,
    sourceType: 'AUTO_RULE',
    revokeReason,
    UserBadgeSource: [{ isActive: status === 'ACTIVE', sourceType: 'AUTO_RULE', sourceId: `rule-${badgeId}`, expiresAt: null, revokeReason }],
  }
}

test('revoked Leo history never blocks a missing Virgo target', () => {
  const decision = resolveZodiacBadgeGrantEligibility({
    badgeId: 'badge-virgo',
    birthMonth: 9,
    birthDay: 2,
    targetZodiac: 'VIRGO',
    history: [historyRow('badge-leo', 'REVOKED', 'ADMIN_REVOKED')],
    now,
  })

  assert.equal(decision.birthdayZodiac, 'VIRGO')
  assert.equal(decision.currentZodiac, 'VIRGO')
  assert.equal(decision.hasActiveTargetOwnership, false)
  assert.equal(decision.hasBlockedTargetHistory, false)
  assert.equal(decision.eligible, true)
})

test('an active wrong-zodiac ownership is context only for the target decision', () => {
  const decision = resolveZodiacBadgeGrantEligibility({
    badgeId: 'badge-virgo',
    birthMonth: 9,
    birthDay: 2,
    targetZodiac: 'VIRGO',
    history: [historyRow('badge-leo', 'ACTIVE')],
    now,
  })

  assert.equal(decision.hasActiveTargetOwnership, false)
  assert.equal(decision.hasBlockedTargetHistory, false)
  assert.equal(decision.eligible, true)
})

test('target revoke policy is evaluated only against the same zodiac badge', () => {
  const normalRevoke = resolveZodiacBadgeGrantEligibility({
    badgeId: 'badge-virgo',
    birthMonth: 9,
    birthDay: 2,
    targetZodiac: 'VIRGO',
    history: [historyRow('badge-virgo', 'REVOKED', 'ADMIN_REVOKED'), historyRow('badge-leo', 'REVOKED', 'ADMIN_REVOKED')],
    now,
  })
  const incidentRevoke = resolveZodiacBadgeGrantEligibility({
    badgeId: 'badge-virgo',
    birthMonth: 9,
    birthDay: 2,
    targetZodiac: 'VIRGO',
    history: [historyRow('badge-virgo', 'REVOKED', INCIDENT_INVALID_ZODIAC_PERIOD_GRANT), historyRow('badge-leo', 'REVOKED', 'ADMIN_REVOKED')],
    now,
  })

  assert.equal(normalRevoke.hasBlockedTargetHistory, true)
  assert.equal(normalRevoke.eligible, false)
  assert.equal(incidentRevoke.hasBlockedTargetHistory, false)
  assert.equal(incidentRevoke.eligible, true)
})

test('the target must be in the current zodiac period and birthday changes resolve independently', () => {
  assert.equal(resolveZodiacBadgeGrantEligibility({
    badgeId: 'badge-leo',
    birthMonth: 8,
    birthDay: 8,
    targetZodiac: 'LEO',
    history: [],
    now,
  }).eligible, false)
  assert.equal(resolveZodiacBadgeGrantEligibility({
    badgeId: 'badge-virgo',
    birthMonth: 9,
    birthDay: 2,
    targetZodiac: 'VIRGO',
    history: [],
    now,
  }).eligible, true)
})

test('zodiac idempotency keys distinguish badge and target sign', () => {
  const leoKey = zodiacGrantKey({ badgeId: 'badge-leo', ruleId: 'rule-zodiac', targetZodiac: 'LEO' })
  const virgoKey = zodiacGrantKey({ badgeId: 'badge-virgo', ruleId: 'rule-zodiac', targetZodiac: 'VIRGO' })
  assert.notEqual(leoKey, virgoKey)
  assert.match(leoKey, /badge-leo.*LEO/)
  assert.match(virgoKey, /badge-virgo.*VIRGO/)
})
