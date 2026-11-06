import assert from 'node:assert/strict'
import test from 'node:test'
import {
  verifyBackupAttestation,
  readAttestationFile,
} from '../scripts/production-backup-gate.mjs'

const DEPLOY_SHA = 'a'.repeat(40)
const NOW = Date.parse('2026-11-06T18:00:00+08:00')

function validAttestation() {
  return {
    schemaVersion: 1,
    backupId: 'cynos-auto-20261106-170000',
    backupType: 'AUTOMATED_SNAPSHOT',
    backupCompletedAt: '2026-11-06T17:00:00+08:00',
    pitrAvailable: true,
    pitrRetentionDays: 7,
    restoreDrillVerified: true,
    restoreDrillAt: '2026-11-06T17:30:00+08:00',
    verifiedBy: 'release-operator',
    targetReleaseSha: DEPLOY_SHA,
    expiresAt: '2026-11-07T00:00:00+08:00',
  }
}

function verify(data: unknown) {
  return verifyBackupAttestation(JSON.stringify(data), { deploySha: DEPLOY_SHA, now: NOW })
}

test('a recent, drilled, PITR-backed attestation for the exact SHA is accepted', () => {
  const result = verify(validAttestation())
  assert.equal(result.ok, true)
  assert.equal(result.reason, null)
  assert.equal(result.evidence?.pitrAvailable, true)
  assert.equal(result.evidence?.restoreDrillVerified, true)
  assert.equal(result.evidence?.backupAgeMinutes, 60)
  assert.equal(result.evidence?.targetReleaseSha, DEPLOY_SHA)
})

test('default posture is REJECT: missing or unreadable attestation never passes', () => {
  const missing = verifyBackupAttestation('', { deploySha: DEPLOY_SHA, now: NOW })
  assert.equal(missing.ok, false)
  assert.equal(missing.reason, 'ATTESTATION_EMPTY')

  const invalid = verifyBackupAttestation('{not json', { deploySha: DEPLOY_SHA, now: NOW })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.reason, 'ATTESTATION_INVALID_JSON')

  assert.throws(() => readAttestationFile('/definitely/not/a/real/backup-attestation.json'))
})

test('UNKNOWN / unverified PITR and restore drill are always rejected', () => {
  const noPitr = validAttestation()
  noPitr.pitrAvailable = false
  assert.equal(verify(noPitr).reason, 'PITR_NOT_CONFIRMED')

  const noDrill = validAttestation()
  noDrill.restoreDrillVerified = false
  assert.equal(verify(noDrill).reason, 'RESTORE_DRILL_NOT_VERIFIED')

  const noRetention = validAttestation() as Record<string, unknown>
  noRetention.pitrRetentionDays = 'UNKNOWN'
  assert.equal(verify(noRetention).reason, 'PITR_RETENTION_INVALID')
})

test('a stale, expired, future or long-lived attestation is rejected', () => {
  const stale = validAttestation()
  stale.backupCompletedAt = '2026-11-05T01:00:00+08:00'
  stale.restoreDrillAt = '2026-11-05T02:00:00+08:00'
  assert.equal(verify(stale).reason, 'BACKUP_TOO_OLD')

  const expired = validAttestation()
  expired.expiresAt = '2026-11-06T17:00:00+08:00'
  assert.equal(verify(expired).reason, 'ATTESTATION_EXPIRED')

  const longLived = validAttestation()
  longLived.expiresAt = '2026-12-06T18:00:00+08:00'
  assert.equal(verify(longLived).reason, 'ATTESTATION_TTL_TOO_LONG')

  const futureBackup = validAttestation()
  futureBackup.backupCompletedAt = '2026-11-06T19:00:00+08:00'
  assert.equal(verify(futureBackup).reason, 'BACKUP_TIME_IN_FUTURE')
})

test('an attestation cannot be reused for a different release SHA', () => {
  const result = verifyBackupAttestation(JSON.stringify(validAttestation()), {
    deploySha: 'b'.repeat(40),
    now: NOW,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'TARGET_RELEASE_SHA_MISMATCH')

  const invalidSha = verifyBackupAttestation(JSON.stringify(validAttestation()), {
    deploySha: 'not-a-sha',
    now: NOW,
  })
  assert.equal(invalidSha.reason, 'DEPLOY_SHA_INVALID')
})

test('restore drill must happen after the backup it verifies', () => {
  const data = validAttestation()
  data.restoreDrillAt = '2026-11-06T16:00:00+08:00'
  assert.equal(verify(data).reason, 'RESTORE_DRILL_PRECEDES_BACKUP')
})

test('malformed identifiers, types and schema versions are rejected', () => {
  const badVersion = validAttestation() as Record<string, unknown>
  badVersion.schemaVersion = 2
  assert.equal(verify(badVersion).reason, 'SCHEMA_VERSION_UNSUPPORTED')

  const badType = validAttestation()
  badType.backupType = 'UNKNOWN_VENDOR_SNAPSHOT'
  assert.equal(verify(badType).reason, 'BACKUP_TYPE_UNSUPPORTED')

  const badId = validAttestation()
  badId.backupId = '../../etc/passwd'
  assert.equal(verify(badId).reason, 'BACKUP_ID_INVALID')

  assert.equal(verify([]).reason, 'ATTESTATION_INVALID_SHAPE')
})
