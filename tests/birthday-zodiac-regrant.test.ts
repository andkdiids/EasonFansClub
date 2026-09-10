import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { INCIDENT_INVALID_ZODIAC_PERIOD_GRANT, resolveAutomaticRegrantEligibility } from '@/lib/badge-revocation'

const now = new Date('2026-08-10T04:00:00.000Z')

function revokedHistory(revokeReason: string | null, sourceType = 'AUTO_RULE') {
  return [{
    status: 'REVOKED',
    expiresAt: null,
    sourceType,
    revokeReason,
    UserBadgeSource: [{
      isActive: false,
      sourceType,
      sourceId: 'zodiac-rule-leo',
      expiresAt: null,
      revokeReason,
    }],
  }]
}

test('incident-revoked zodiac ownership is discoverable and regrantable in the active period', () => {
  const decision = resolveAutomaticRegrantEligibility(revokedHistory(INCIDENT_INVALID_ZODIAC_PERIOD_GRANT), now)
  assert.deepEqual(decision, {
    allowed: true,
    reason: 'INCIDENT_REVOKED',
    revokeReason: INCIDENT_INVALID_ZODIAC_PERIOD_GRANT,
  })
})

test('normal, administrator, and unknown revokes remain blocked', () => {
  for (const reason of ['NORMAL_EXPIRED', 'ADMIN_REVOKED', 'SYSTEM_REVOKED', null]) {
    const decision = resolveAutomaticRegrantEligibility(revokedHistory(reason), now)
    assert.equal(decision.allowed, false, reason || 'unknown revoke reason')
    assert.equal(decision.reason, 'NORMAL_REVOKED')
  }
})

test('an incident reason on a non-automatic source does not permit automatic regrant', () => {
  const decision = resolveAutomaticRegrantEligibility(
    revokedHistory(INCIDENT_INVALID_ZODIAC_PERIOD_GRANT, 'ADMIN_GRANT'),
    now,
  )
  assert.equal(decision.allowed, false)
  assert.equal(decision.reason, 'NORMAL_REVOKED')
})

test('active ownership always wins over incident history and prevents duplicate ownership', () => {
  const decision = resolveAutomaticRegrantEligibility([
    ...revokedHistory(INCIDENT_INVALID_ZODIAC_PERIOD_GRANT),
    {
      status: 'ACTIVE',
      expiresAt: null,
      sourceType: 'ADMIN_GRANT',
      revokeReason: null,
      UserBadgeSource: [{ isActive: true, sourceType: 'ADMIN_GRANT', sourceId: 'manual', expiresAt: null, revokeReason: null }],
    },
  ], now)
  assert.deepEqual(decision, { allowed: false, reason: 'ACTIVE_OWNERSHIP', revokeReason: null })
})

test('zodiac regrant path stores, reads, and displays the incident reason', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync('prisma/migrations/20260910190000_add_badge_revoke_reason/migration.sql', 'utf8')
  const service = readFileSync('lib/badge-service.ts', 'utf8')
  const engine = readFileSync('lib/badge-rule-engine.ts', 'utf8')
  const manager = readFileSync('app/admin/badges/BadgeAdminManager.tsx', 'utf8')

  assert.match(schema, /revokeReason\s+String\?\s+@db\.VarChar\(64\)/)
  assert.match(migration, /ADD COLUMN `revokeReason` VARCHAR\(64\) NULL/)
  assert.match(migration, /INCIDENT_INVALID_ZODIAC_PERIOD_GRANT/)
  assert.match(service, /resolveZodiacBadgeGrantEligibility/)
  assert.match(service, /skippedGrantResult/)
  assert.match(engine, /resolveZodiacBadgeGrantEligibility/)
  assert.match(engine, /regrantableCount/)
  assert.match(manager, /事故撤回/)
  assert.match(manager, /revokeReason/)
})
