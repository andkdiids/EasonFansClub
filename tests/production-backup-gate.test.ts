import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  verifyBackupAttestation,
  readAttestationFile,
  assertAttestationFileStat,
} from '../scripts/production-backup-gate.mjs'

const DEPLOY_SHA = 'a'.repeat(40)
const OTHER_SHA = 'b'.repeat(40)
const NOW = Date.parse('2026-11-06T18:00:00+08:00')
const NOW_ISO = '2026-11-06T18:00:00+08:00'
const GATE_PATH = path.resolve('scripts/production-backup-gate.mjs')

/** schemaVersion 1: unchanged strict attestation, including a REAL drill. */
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

/**
 * schemaVersion 2: a written, named, SHA-bound approval waives ONLY the
 * restore drill. Every other value is a real cloud-console fact supplied by a
 * human; this fixture is a local test artefact, never a production attestation.
 */
function validWaiver(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    backupId: 'cynos-auto-20261106-170000',
    backupType: 'AUTOMATED_SNAPSHOT',
    backupCompletedAt: '2026-11-06T17:00:00+08:00',
    pitrAvailable: true,
    pitrRetentionDays: 7,
    verifiedBy: 'release-operator',
    restoreDrillWaiver: {
      approvedBy: 'eason',
      approvedAt: '2026-11-06T17:45:00+08:00',
      riskStatement: 'Automatic backup and PITR are not a tested restore; the database cannot be rolled back. Risk accepted for this release only.',
      releaseId: DEPLOY_SHA,
    },
    targetReleaseSha: DEPLOY_SHA,
    expiresAt: '2026-11-07T00:00:00+08:00',
  }
}

interface WaiverOptions {
  deploySha?: string
  now?: number
  allowRestoreDrillWaiver?: boolean
}

function verify(data: unknown) {
  return verifyBackupAttestation(JSON.stringify(data), { deploySha: DEPLOY_SHA, now: NOW })
}

function verifyWaiver(data: unknown, options: WaiverOptions = {}) {
  return verifyBackupAttestation(JSON.stringify(data), {
    deploySha: options.deploySha ?? DEPLOY_SHA,
    now: options.now ?? NOW,
    allowRestoreDrillWaiver: options.allowRestoreDrillWaiver ?? true,
  })
}

// ---------------------------------------------------------------------------
// schemaVersion 1 (strict) regression: NOT weakened by the new waiver path.
// ---------------------------------------------------------------------------

test('a recent, drilled, PITR-backed attestation for the exact SHA is accepted', () => {
  const result = verify(validAttestation())
  assert.equal(result.ok, true)
  assert.equal(result.reason, null)
  assert.equal(result.evidence?.pitrAvailable, true)
  assert.equal(result.evidence?.restoreDrillVerified, true)
  assert.equal(result.evidence?.restoreDrillWaived, false)
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
    deploySha: OTHER_SHA,
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

test('malformed identifiers, types and unsupported schema versions are rejected', () => {
  const badVersion = validAttestation() as Record<string, unknown>
  badVersion.schemaVersion = 3
  assert.equal(verify(badVersion).reason, 'SCHEMA_VERSION_UNSUPPORTED')

  const badType = validAttestation()
  badType.backupType = 'UNKNOWN_VENDOR_SNAPSHOT'
  assert.equal(verify(badType).reason, 'BACKUP_TYPE_UNSUPPORTED')

  const badId = validAttestation()
  badId.backupId = '../../etc/passwd'
  assert.equal(verify(badId).reason, 'BACKUP_ID_INVALID')

  assert.equal(verify([]).reason, 'ATTESTATION_INVALID_SHAPE')
})

// ---------------------------------------------------------------------------
// schemaVersion 2 (one-off, explicitly approved restore-drill waiver).
// ---------------------------------------------------------------------------

test('POSITIVE: a written, named, exact-SHA waiver passes with drill explicitly NOT verified', () => {
  const result = verifyWaiver(validWaiver())
  assert.equal(result.ok, true)
  assert.equal(result.reason, null)
  assert.equal(result.evidence?.schemaVersion, 2)
  assert.equal(result.evidence?.restoreDrillVerified, false)
  assert.equal(result.evidence?.restoreDrillWaived, true)
  assert.equal(result.evidence?.restoreDrillAt, null)
  assert.equal(result.evidence?.backupType, 'AUTOMATED_SNAPSHOT')
  assert.equal(result.evidence?.pitrAvailable, true)
  assert.equal(result.evidence?.pitrRetentionDays, 7)
  assert.equal(result.evidence?.waiver?.approvedBy, 'eason')
  assert.equal(result.evidence?.waiver?.releaseId, DEPLOY_SHA)
  assert.equal(result.evidence?.targetReleaseSha, DEPLOY_SHA)
})

test('NEGATIVE: the waiver path is unreachable without an explicit workflow approval', () => {
  assert.equal(verifyWaiver(validWaiver(), { allowRestoreDrillWaiver: false }).reason, 'WAIVER_NOT_ENABLED')
  assert.equal(
    verifyBackupAttestation(JSON.stringify(validWaiver()), { deploySha: DEPLOY_SHA, now: NOW }).reason,
    'WAIVER_NOT_ENABLED',
  )
})

test('NEGATIVE: a fabricated restore-drill record inside a waiver is rejected', () => {
  const fakeVerified = validWaiver()
  fakeVerified.restoreDrillVerified = true
  assert.equal(verifyWaiver(fakeVerified).reason, 'RESTORE_DRILL_RECORD_FORBIDDEN_IN_WAIVER')

  const fakeTime = validWaiver()
  fakeTime.restoreDrillAt = '2026-11-06T17:30:00+08:00'
  assert.equal(verifyWaiver(fakeTime).reason, 'RESTORE_DRILL_RECORD_FORBIDDEN_IN_WAIVER')

  const fakeReport = validWaiver()
  fakeReport.restoreDrillReport = 'restore succeeded'
  assert.equal(verifyWaiver(fakeReport).reason, 'RESTORE_DRILL_RECORD_FORBIDDEN_IN_WAIVER')
})

test('EXPIRED: attestation expiry, over-long TTL and stale written approval are rejected', () => {
  const expired = validWaiver()
  expired.expiresAt = '2026-11-06T17:00:00+08:00'
  assert.equal(verifyWaiver(expired).reason, 'ATTESTATION_EXPIRED')

  const longLived = validWaiver()
  longLived.expiresAt = '2026-12-06T18:00:00+08:00'
  assert.equal(verifyWaiver(longLived).reason, 'ATTESTATION_TTL_TOO_LONG')

  const staleApproval = validWaiver()
  const waiver = staleApproval.restoreDrillWaiver as Record<string, unknown>
  waiver.approvedAt = '2026-11-06T09:00:00+08:00'
  assert.equal(verifyWaiver(staleApproval).reason, 'WAIVER_APPROVAL_EXPIRED')

  const futureApproval = validWaiver()
  const futureWaiver = futureApproval.restoreDrillWaiver as Record<string, unknown>
  futureWaiver.approvedAt = '2026-11-06T19:00:00+08:00'
  assert.equal(verifyWaiver(futureApproval).reason, 'WAIVER_APPROVED_AT_IN_FUTURE')

  const beforeBackup = validWaiver()
  const earlyWaiver = beforeBackup.restoreDrillWaiver as Record<string, unknown>
  earlyWaiver.approvedAt = '2026-11-06T16:00:00+08:00'
  assert.equal(verifyWaiver(beforeBackup).reason, 'WAIVER_APPROVAL_PRECEDES_BACKUP')
})

test('SHA MISMATCH: neither targetReleaseSha nor the written releaseId may be reused', () => {
  const wrongTarget = validWaiver()
  wrongTarget.targetReleaseSha = OTHER_SHA
  assert.equal(verifyWaiver(wrongTarget).reason, 'TARGET_RELEASE_SHA_MISMATCH')

  const wrongReleaseId = validWaiver()
  const waiver = wrongReleaseId.restoreDrillWaiver as Record<string, unknown>
  waiver.releaseId = OTHER_SHA
  assert.equal(verifyWaiver(wrongReleaseId).reason, 'WAIVER_RELEASE_ID_MISMATCH')

  const otherDeploySha = verifyWaiver(validWaiver(), { deploySha: OTHER_SHA })
  assert.equal(otherDeploySha.reason, 'TARGET_RELEASE_SHA_MISMATCH')
})

test('MISSING BACKUP: a waiver still requires a real, recent automatic snapshot', () => {
  const noId = validWaiver()
  delete noId.backupId
  assert.equal(verifyWaiver(noId).reason, 'BACKUP_ID_INVALID')

  const inventedId = validWaiver()
  inventedId.backupId = '../fabricated'
  assert.equal(verifyWaiver(inventedId).reason, 'BACKUP_ID_INVALID')

  const manualOnly = validWaiver()
  manualOnly.backupType = 'MANUAL_SNAPSHOT'
  assert.equal(verifyWaiver(manualOnly).reason, 'BACKUP_TYPE_UNSUPPORTED')

  const noTime = validWaiver()
  noTime.backupCompletedAt = 'UNKNOWN'
  assert.equal(verifyWaiver(noTime).reason, 'BACKUP_COMPLETED_AT_INVALID')

  const stale = validWaiver()
  stale.backupCompletedAt = '2026-11-05T01:00:00+08:00'
  assert.equal(verifyWaiver(stale).reason, 'BACKUP_TOO_OLD')

  const future = validWaiver()
  future.backupCompletedAt = '2026-11-06T19:00:00+08:00'
  assert.equal(verifyWaiver(future).reason, 'BACKUP_TIME_IN_FUTURE')
})

test('PITR UNAVAILABLE: a waiver still requires confirmed PITR and a valid retention window', () => {
  const noPitr = validWaiver()
  noPitr.pitrAvailable = false
  assert.equal(verifyWaiver(noPitr).reason, 'PITR_NOT_CONFIRMED')

  const unknownPitr = validWaiver()
  unknownPitr.pitrAvailable = 'UNKNOWN'
  assert.equal(verifyWaiver(unknownPitr).reason, 'PITR_NOT_CONFIRMED')

  const noRetention = validWaiver()
  noRetention.pitrRetentionDays = 0
  assert.equal(verifyWaiver(noRetention).reason, 'PITR_RETENTION_INVALID')

  const unknownRetention = validWaiver()
  unknownRetention.pitrRetentionDays = '7 days'
  assert.equal(verifyWaiver(unknownRetention).reason, 'PITR_RETENTION_INVALID')
})

test('WRITTEN APPROVAL: approver, time, risk statement and release id are all mandatory', () => {
  const noBlock = validWaiver()
  delete noBlock.restoreDrillWaiver
  assert.equal(verifyWaiver(noBlock).reason, 'WAIVER_BLOCK_MISSING')

  const arrayBlock = validWaiver()
  arrayBlock.restoreDrillWaiver = []
  assert.equal(verifyWaiver(arrayBlock).reason, 'WAIVER_BLOCK_MISSING')

  for (const field of ['approvedBy', 'approvedAt', 'riskStatement', 'releaseId']) {
    const data = validWaiver()
    const waiver = data.restoreDrillWaiver as Record<string, unknown>
    delete waiver[field]
    assert.equal(verifyWaiver(data).reason, 'WAIVER_FIELD_MISSING', `missing ${field}`)
  }

  const badApprover = validWaiver()
  const approver = badApprover.restoreDrillWaiver as Record<string, unknown>
  approver.approvedBy = '../../root'
  assert.equal(verifyWaiver(badApprover).reason, 'WAIVER_APPROVED_BY_INVALID')

  const emptyRisk = validWaiver()
  const risk = emptyRisk.restoreDrillWaiver as Record<string, unknown>
  risk.riskStatement = 'ok'
  assert.equal(verifyWaiver(emptyRisk).reason, 'WAIVER_RISK_STATEMENT_INVALID')

  const badTime = validWaiver()
  const badTimeWaiver = badTime.restoreDrillWaiver as Record<string, unknown>
  badTimeWaiver.approvedAt = 'UNKNOWN'
  assert.equal(verifyWaiver(badTime).reason, 'WAIVER_APPROVED_AT_INVALID')

  const badVerifier = validWaiver()
  badVerifier.verifiedBy = '../../etc'
  assert.equal(verifyWaiver(badVerifier).reason, 'VERIFIED_BY_INVALID')
})

test('POSIX attestation file permissions and ownership are never relaxed', () => {
  const safe = { isFile: () => true, isSymbolicLink: () => false, mode: 0o600, uid: 1000 }
  assert.equal(assertAttestationFileStat(safe, { platform: 'linux', uid: 1000 }), true)
  assert.throws(
    () => assertAttestationFileStat({ ...safe, mode: 0o664 }, { platform: 'linux', uid: 1000 }),
    /ATTESTATION_UNSAFE_PERMISSIONS/,
  )
  assert.throws(
    () => assertAttestationFileStat({ ...safe, mode: 0o602 }, { platform: 'linux', uid: 1000 }),
    /ATTESTATION_UNSAFE_PERMISSIONS/,
  )
  assert.throws(
    () => assertAttestationFileStat({ ...safe, uid: 1001 }, { platform: 'linux', uid: 1000 }),
    /ATTESTATION_UNEXPECTED_OWNER/,
  )
  assert.throws(
    () => assertAttestationFileStat({ ...safe, isSymbolicLink: () => true }, { platform: 'linux', uid: 1000 }),
    /ATTESTATION_NOT_A_REGULAR_FILE/,
  )
  // Windows dev machines ignore meaningless NTFS mode bits; the POSIX
  // production host never does.
  assert.equal(assertAttestationFileStat({ ...safe, mode: 0o666 }, { platform: 'win32', uid: 1000 }), true)
})

test('CLI: an approved waiver prints RESTORE_DRILL_VERIFIED=NO and RESTORE_DRILL_WAIVED=YES', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-backup-gate-'))
  const file = path.join(dir, '.backup-verification.test-fixture.json')
  try {
    // Local test fixture only: never written to the production host and never
    // used as a real backup attestation.
    writeFileSync(file, JSON.stringify(validWaiver()))
    chmodSync(file, 0o600)
    const run = spawnSync(process.execPath, [
      GATE_PATH, '--cli', 'verify',
      '--attestation', file,
      '--deploy-sha', DEPLOY_SHA,
      '--waiver-mode', 'approved',
      '--now', NOW_ISO,
    ], { encoding: 'utf8' })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /^BACKUP_GATE=VERIFIED$/m)
    assert.match(run.stdout, /^BACKUP_GATE_SCHEMA_VERSION=2$/m)
    assert.match(run.stdout, /^RESTORE_DRILL_VERIFIED=NO$/m)
    assert.match(run.stdout, /^RESTORE_DRILL_WAIVED=YES$/m)
    assert.match(run.stdout, /^RESTORE_DRILL_WAIVER_RELEASE_ID=a{40}$/m)
    assert.doesNotMatch(run.stdout, /RESTORE_DRILL_VERIFIED=YES/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI: the default (push-event) mode refuses a v2 attestation', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-backup-gate-'))
  const file = path.join(dir, '.backup-verification.test-fixture.json')
  try {
    writeFileSync(file, JSON.stringify(validWaiver()))
    chmodSync(file, 0o600)
    const run = spawnSync(process.execPath, [
      GATE_PATH, '--cli', 'verify',
      '--attestation', file,
      '--deploy-sha', DEPLOY_SHA,
      '--now', NOW_ISO,
    ], { encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.match(run.stdout, /^BACKUP_GATE=REJECTED$/m)
    assert.match(run.stdout, /^BACKUP_GATE_REASON=WAIVER_NOT_ENABLED$/m)
    assert.match(run.stdout, /^BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
