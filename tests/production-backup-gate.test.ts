import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  verifyBackupAttestation,
  readAttestationFile,
  assertAttestationFileStat,
  consumeRiskAcceptance,
  issueRiskAcceptance,
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

/**
 * schemaVersion 3: explicit, one-off, exact-SHA risk acceptance for a release
 * whose owner accepts that NO independent backup/PITR verification and NO restore
 * drill were performed. It asserts NO backup/PITR/drill fact (those would be
 * fabrications). Local test artefact only; never used as a production
 * attestation.
 */
function validRiskAcceptance(): Record<string, unknown> {
  return {
    schemaVersion: 3,
    attestationId: '550e8400-e29b-41d4-a716-446655440000',
    issuedByWorkflowRunId: '800000001',
    targetReleaseSha: DEPLOY_SHA,
    expiresAt: '2026-11-07T00:00:00+08:00',
    riskAcceptance: {
      approvedBy: 'andkdiids',
      approvedAt: '2026-11-06T17:45:00+08:00',
      approvalCommentId: '6736686769',
      approvalAuthorAssociation: 'OWNER',
      riskStatement: 'No independent CynosDB backup/PITR verification and no restore drill. Risk accepted for this release only.',
      releaseId: DEPLOY_SHA,
      noIndependentBackupVerification: true,
      noRestoreDrill: true,
    },
  }
}

interface WaiverOptions {
  deploySha?: string
  now?: number
  allowRestoreDrillWaiver?: boolean
}

interface RiskOptions {
  deploySha?: string
  now?: number
  allowRiskAcceptance?: boolean
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

function verifyRisk(data: unknown, options: RiskOptions = {}) {
  return verifyBackupAttestation(JSON.stringify(data), {
    deploySha: options.deploySha ?? DEPLOY_SHA,
    now: options.now ?? NOW,
    allowRiskAcceptance: options.allowRiskAcceptance ?? true,
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
  badVersion.schemaVersion = 99
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

// ---------------------------------------------------------------------------
// schemaVersion 3 (one-off, explicit risk acceptance: NO backup/PITR verification
// and NO restore drill were performed; nothing is asserted as verified).
// ---------------------------------------------------------------------------

test('POSITIVE: an explicit, exact-SHA risk acceptance passes with nothing claimed verified', () => {
  const result = verifyRisk(validRiskAcceptance())
  assert.equal(result.ok, true)
  assert.equal(result.reason, null)
  assert.equal(result.evidence?.schemaVersion, 3)
  assert.equal(result.evidence?.backupVerified, false)
  assert.equal(result.evidence?.pitrVerified, false)
  assert.equal(result.evidence?.restoreDrillVerified, false)
  assert.equal(result.evidence?.restoreDrillWaived, true)
  assert.equal(result.evidence?.riskAccepted, true)
  assert.equal(result.evidence?.riskAcceptance?.approvedBy, 'andkdiids')
  assert.equal(result.evidence?.riskAcceptance?.releaseId, DEPLOY_SHA)
  assert.equal(result.evidence?.targetReleaseSha, DEPLOY_SHA)
})

test('NEGATIVE: the risk-acceptance path is unreachable without an explicit workflow approval', () => {
  assert.equal(verifyRisk(validRiskAcceptance(), { allowRiskAcceptance: false }).reason, 'RISK_ACCEPTANCE_NOT_ENABLED')
  assert.equal(
    verifyBackupAttestation(JSON.stringify(validRiskAcceptance()), { deploySha: DEPLOY_SHA, now: NOW }).reason,
    'RISK_ACCEPTANCE_NOT_ENABLED',
  )
})

test('NEGATIVE: fabricating any backup/PITR/drill fact inside a risk acceptance is rejected', () => {
  const withBackupId = validRiskAcceptance()
  withBackupId.backupId = 'cynos-auto-20261106-170000'
  assert.equal(verifyRisk(withBackupId).reason, 'RISK_ACCEPTANCE_MUST_NOT_ASSERT_BACKUP')

  const withPitr = validRiskAcceptance()
  withPitr.pitrAvailable = true
  assert.equal(verifyRisk(withPitr).reason, 'RISK_ACCEPTANCE_MUST_NOT_ASSERT_BACKUP')

  const withRetention = validRiskAcceptance()
  withRetention.pitrRetentionDays = 7
  assert.equal(verifyRisk(withRetention).reason, 'RISK_ACCEPTANCE_MUST_NOT_ASSERT_BACKUP')

  const withDrillTime = validRiskAcceptance()
  withDrillTime.restoreDrillAt = '2026-11-06T17:30:00+08:00'
  assert.equal(verifyRisk(withDrillTime).reason, 'RISK_ACCEPTANCE_MUST_NOT_ASSERT_BACKUP')

  const withVerifiedBy = validRiskAcceptance()
  withVerifiedBy.verifiedBy = 'release-operator'
  assert.equal(verifyRisk(withVerifiedBy).reason, 'RISK_ACCEPTANCE_MUST_NOT_ASSERT_BACKUP')
})

test('NEGATIVE: missing/!true acknowledgement flags, block or required fields are rejected', () => {
  const noBlock = validRiskAcceptance()
  delete noBlock.riskAcceptance
  assert.equal(verifyRisk(noBlock).reason, 'RISK_ACCEPTANCE_BLOCK_MISSING')

  const arrayBlock = validRiskAcceptance()
  arrayBlock.riskAcceptance = []
  assert.equal(verifyRisk(arrayBlock).reason, 'RISK_ACCEPTANCE_BLOCK_MISSING')

  for (const field of ['approvedBy', 'approvedAt', 'approvalCommentId', 'approvalAuthorAssociation', 'riskStatement', 'releaseId']) {
    const data = validRiskAcceptance()
    const risk = data.riskAcceptance as Record<string, unknown>
    delete risk[field]
    assert.equal(verifyRisk(data).reason, 'RISK_ACCEPTANCE_FIELD_MISSING', `missing ${field}`)
  }

  const noBackupFlag = validRiskAcceptance()
  ;(noBackupFlag.riskAcceptance as Record<string, unknown>).noIndependentBackupVerification = false
  assert.equal(verifyRisk(noBackupFlag).reason, 'RISK_ACCEPTANCE_BACKUP_FLAG_INVALID')

  const noDrillFlag = validRiskAcceptance()
  ;(noDrillFlag.riskAcceptance as Record<string, unknown>).noRestoreDrill = false
  assert.equal(verifyRisk(noDrillFlag).reason, 'RISK_ACCEPTANCE_DRILL_FLAG_INVALID')

  const badApprover = validRiskAcceptance()
  ;(badApprover.riskAcceptance as Record<string, unknown>).approvedBy = '../../root'
  assert.equal(verifyRisk(badApprover).reason, 'RISK_ACCEPTANCE_APPROVED_BY_INVALID')
})

test('EXPIRED / SHA MISMATCH: risk acceptance is SHA-bound, short-lived and approval-age-bounded', () => {
  const expired = validRiskAcceptance()
  expired.expiresAt = '2026-11-06T17:00:00+08:00'
  assert.equal(verifyRisk(expired).reason, 'ATTESTATION_EXPIRED')

  const longLived = validRiskAcceptance()
  longLived.expiresAt = '2026-12-06T18:00:00+08:00'
  assert.equal(verifyRisk(longLived).reason, 'ATTESTATION_TTL_TOO_LONG')

  const wrongTarget = validRiskAcceptance()
  wrongTarget.targetReleaseSha = OTHER_SHA
  assert.equal(verifyRisk(wrongTarget).reason, 'TARGET_RELEASE_SHA_MISMATCH')

  const wrongReleaseId = validRiskAcceptance()
  ;(wrongReleaseId.riskAcceptance as Record<string, unknown>).releaseId = OTHER_SHA
  assert.equal(verifyRisk(wrongReleaseId).reason, 'RISK_ACCEPTANCE_RELEASE_ID_MISMATCH')

  const otherDeploySha = verifyRisk(validRiskAcceptance(), { deploySha: OTHER_SHA })
  assert.equal(otherDeploySha.reason, 'TARGET_RELEASE_SHA_MISMATCH')

  const staleApproval = validRiskAcceptance()
  ;(staleApproval.riskAcceptance as Record<string, unknown>).approvedAt = '2026-11-06T09:00:00+08:00'
  assert.equal(verifyRisk(staleApproval).reason, 'RISK_ACCEPTANCE_APPROVAL_EXPIRED')

  const futureApproval = validRiskAcceptance()
  ;(futureApproval.riskAcceptance as Record<string, unknown>).approvedAt = '2026-11-06T19:00:00+08:00'
  assert.equal(verifyRisk(futureApproval).reason, 'RISK_ACCEPTANCE_APPROVED_AT_IN_FUTURE')
})

test('CLI: an approved risk acceptance prints BACKUP_VERIFIED=NO and RISK_ACCEPTED=YES, never a backup id', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-backup-gate-'))
  const file = path.join(dir, '.backup-verification.test-fixture.json')
  try {
    writeFileSync(file, JSON.stringify(validRiskAcceptance()))
    chmodSync(file, 0o600)
    const run = spawnSync(process.execPath, [
      GATE_PATH, '--cli', 'verify',
      '--attestation', file,
      '--deploy-sha', DEPLOY_SHA,
      '--risk-acceptance-mode', 'approved',
      '--now', NOW_ISO,
    ], { encoding: 'utf8' })
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stdout, /^BACKUP_GATE=VERIFIED$/m)
    assert.match(run.stdout, /^BACKUP_GATE_SCHEMA_VERSION=3$/m)
    assert.match(run.stdout, /^BACKUP_VERIFIED=NO$/m)
    assert.match(run.stdout, /^BACKUP_PITR_VERIFIED=NO$/m)
    assert.match(run.stdout, /^RESTORE_DRILL_VERIFIED=NO$/m)
    assert.match(run.stdout, /^RISK_ACCEPTED=YES$/m)
    assert.match(run.stdout, /^RISK_ACCEPTANCE_RELEASE_ID=a{40}$/m)
    assert.doesNotMatch(run.stdout, /^BACKUP_ID=/m)
    assert.doesNotMatch(run.stdout, /BACKUP_PITR_VERIFIED=YES/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CLI: the default (push-event) mode refuses a v3 attestation', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-backup-gate-'))
  const file = path.join(dir, '.backup-verification.test-fixture.json')
  try {
    writeFileSync(file, JSON.stringify(validRiskAcceptance()))
    chmodSync(file, 0o600)
    const run = spawnSync(process.execPath, [
      GATE_PATH, '--cli', 'verify',
      '--attestation', file,
      '--deploy-sha', DEPLOY_SHA,
      '--now', NOW_ISO,
    ], { encoding: 'utf8' })
    assert.equal(run.status, 1)
    assert.match(run.stdout, /^BACKUP_GATE=REJECTED$/m)
    assert.match(run.stdout, /^BACKUP_GATE_REASON=RISK_ACCEPTANCE_NOT_ENABLED$/m)
    assert.match(run.stdout, /^BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT$/m)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

function issueFixture({
  now = Date.now(),
  commentId = '6736686769',
  issuanceRunId = '800000001',
  attestationId = '550e8400-e29b-41d4-a716-446655440000',
  deploySha = DEPLOY_SHA,
}: {
  now?: number
  commentId?: string
  issuanceRunId?: string
  attestationId?: string
  deploySha?: string
} = {}) {
  const data = validRiskAcceptance()
  data.attestationId = attestationId
  data.issuedByWorkflowRunId = issuanceRunId
  data.targetReleaseSha = deploySha
  data.expiresAt = new Date(now + 30 * 60_000).toISOString()
  const risk = data.riskAcceptance as Record<string, unknown>
  risk.releaseId = deploySha
  risk.approvalCommentId = commentId
  risk.approvedAt = new Date(now - 5 * 60_000).toISOString()
  return { data, payloadBase64: Buffer.from(JSON.stringify(data)).toString('base64'), now }
}

function runIssueCli(attestationPath: string, payloadBase64: string, workflowRunId: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [
      GATE_PATH,
      '--cli', 'issue',
      '--attestation', attestationPath,
      '--deploy-sha', DEPLOY_SHA,
      '--payload-base64', payloadBase64,
      '--workflow-run-id', workflowRunId,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

function runConsumeCli(attestationPath: string, runId: string, runAttempt: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [
      GATE_PATH,
      '--cli', 'consume',
      '--attestation', attestationPath,
      '--deploy-sha', DEPLOY_SHA,
      '--risk-acceptance-mode', 'approved',
      '--run-id', runId,
      '--run-attempt', runAttempt,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

test('schema v3 issuance is atomic, create-only, and first use is bound to SHA and workflow run', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const fixture = issueFixture()
  try {
    const issued = issueRiskAcceptance({
      attestationPath: proofPath,
      deploySha: DEPLOY_SHA,
      payloadBase64: fixture.payloadBase64,
      workflowRunId: '800000001',
      now: fixture.now,
    })
    assert.equal(issued.approvalCommentId, '6736686769')
    assert.match(issued.proofSha256, /^[0-9a-f]{64}$/)
    assert.equal(JSON.parse(readFileSync(proofPath, 'utf8')).attestationId, fixture.data.attestationId)

    const consumed = consumeRiskAcceptance({
      attestationPath: proofPath,
      deploySha: DEPLOY_SHA,
      runId: '900000001',
      runAttempt: '1',
      now: fixture.now,
    })
    assert.equal(consumed.consumed, true)
    assert.equal(consumed.record?.targetReleaseSha, DEPLOY_SHA)
    assert.equal(consumed.record?.runId, '900000001')
    assert.equal(consumed.record?.runAttempt, '1')
    assert.equal(consumed.record?.attestationId, fixture.data.attestationId)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema v3 rejects same-run retries and different-run replay without resetting consumption', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-replay-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const fixture = issueFixture()
  try {
    issueRiskAcceptance({
      attestationPath: proofPath,
      deploySha: DEPLOY_SHA,
      payloadBase64: fixture.payloadBase64,
      workflowRunId: '800000001',
      now: fixture.now,
    })
    consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000001', runAttempt: '1', now: fixture.now })
    assert.throws(
      () => consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000001', runAttempt: '2', now: fixture.now }),
      /RISK_ACCEPTANCE_ALREADY_CONSUMED/,
    )
    assert.throws(
      () => consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000002', runAttempt: '1', now: fixture.now }),
      /RISK_ACCEPTANCE_ALREADY_CONSUMED/,
    )
    const markerPath = `${proofPath}.state/consumed/6736686769.json`
    assert.equal(JSON.parse(readFileSync(markerPath, 'utf8')).runId, '900000001')
    assert.throws(
      () => issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: fixture.payloadBase64, workflowRunId: '800000001', now: fixture.now }),
      /APPROVAL_COMMENT_ALREADY_USED/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed deployment does not reset a consumed schema v3 proof', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-deploy-failure-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const fixture = issueFixture()
  try {
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: fixture.payloadBase64, workflowRunId: '800000001', now: fixture.now })
    consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000003', runAttempt: '1', now: fixture.now })
    // Model downstream deploy failure: no gate API deletes or rewrites the marker.
    assert.equal(JSON.parse(readFileSync(`${proofPath}.state/consumed/6736686769.json`, 'utf8')).runId, '900000003')
    assert.throws(
      () => consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000004', runAttempt: '1', now: fixture.now }),
      /RISK_ACCEPTANCE_ALREADY_CONSUMED/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema v3 issuer refuses any existing proof, including a symlink, and never overwrites it', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-existing-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const originalPath = path.join(dir, 'original.json')
  const fixture = issueFixture()
  try {
    writeFileSync(originalPath, 'preserve-me')
    try {
      symlinkSync(originalPath, proofPath)
    } catch (error) {
      if (process.platform === 'win32') {
        const errorCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
        t.skip(`Windows symlink creation is unavailable: ${errorCode}`)
        return
      }
      throw error
    }
    assert.throws(
      () => issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: fixture.payloadBase64, workflowRunId: '800000001', now: fixture.now }),
      /ATTESTATION_NOT_A_REGULAR_FILE/,
    )
    assert.equal(readFileSync(originalPath, 'utf8'), 'preserve-me')
    assert.equal(lstatSync(proofPath).isSymbolicLink(), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema v3 issuance race permits exactly one process for the same approval', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-race-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const fixture = issueFixture()
  try {
    const results = await Promise.all([
      runIssueCli(proofPath, fixture.payloadBase64, '800000001'),
      runIssueCli(proofPath, fixture.payloadBase64, '800000001'),
    ])
    assert.deepEqual(results.map(result => result.status).sort(), [0, 1])
    assert.equal(JSON.parse(readFileSync(`${proofPath}.state/issued/6736686769.json`, 'utf8')).attestationId, fixture.data.attestationId)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema v3 consumption race permits exactly one deployment run', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-consume-race-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const fixture = issueFixture()
  try {
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: fixture.payloadBase64, workflowRunId: '800000001', now: fixture.now })
    const results = await Promise.all([
      runConsumeCli(proofPath, '900000010', '1'),
      runConsumeCli(proofPath, '900000011', '1'),
    ])
    assert.deepEqual(results.map(result => result.status).sort(), [0, 1])
    const marker = JSON.parse(readFileSync(`${proofPath}.state/consumed/6736686769.json`, 'utf8'))
    assert.ok(['900000010', '900000011'].includes(marker.runId))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a fresh approval archives a consumed proof without resetting its one-time record', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-reapproval-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const now = Date.now()
  const first = issueFixture({ now, commentId: '6736686769', issuanceRunId: '800000001' })
  const second = issueFixture({ now, commentId: '6736686770', issuanceRunId: '800000002', attestationId: '550e8400-e29b-41d4-a716-446655440001' })
  try {
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: first.payloadBase64, workflowRunId: '800000001', now })
    consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000040', runAttempt: '1', now })
    const oldProofText = readFileSync(proofPath, 'utf8')
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: second.payloadBase64, workflowRunId: '800000002', now })

    const archivedPath = `${proofPath}.state/archived/550e8400-e29b-41d4-a716-446655440000.json`
    const archiveRecord = JSON.parse(readFileSync(`${proofPath}.state/archived/550e8400-e29b-41d4-a716-446655440000.archive.json`, 'utf8'))
    assert.equal(readFileSync(archivedPath, 'utf8'), oldProofText)
    assert.equal(archiveRecord.reason, 'REAPPROVED_AFTER_CONSUMPTION')
    assert.equal(archiveRecord.consumedRunId, '900000040')
    assert.equal(JSON.parse(readFileSync(`${proofPath}.state/consumed/6736686769.json`, 'utf8')).runId, '900000040')
    assert.equal(JSON.parse(readFileSync(proofPath, 'utf8')).attestationId, second.data.attestationId)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a fresh approval for a new main SHA archives the prior consumed SHA without rewriting history', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-sha-change-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const now = Date.now()
  const oldProof = issueFixture({ now, commentId: '6736686769', issuanceRunId: '800000001' })
  const nextProof = issueFixture({ now, commentId: '6736686770', issuanceRunId: '800000002', attestationId: '550e8400-e29b-41d4-a716-446655440001', deploySha: OTHER_SHA })
  try {
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: oldProof.payloadBase64, workflowRunId: '800000001', now })
    consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000041', runAttempt: '1', now })
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: OTHER_SHA, payloadBase64: nextProof.payloadBase64, workflowRunId: '800000002', now })

    const archiveRecord = JSON.parse(readFileSync(`${proofPath}.state/archived/550e8400-e29b-41d4-a716-446655440000.archive.json`, 'utf8'))
    assert.equal(archiveRecord.archivedTargetReleaseSha, DEPLOY_SHA)
    assert.equal(archiveRecord.replacementTargetReleaseSha, OTHER_SHA)
    assert.equal(JSON.parse(readFileSync(`${proofPath}.state/consumed/6736686769.json`, 'utf8')).targetReleaseSha, DEPLOY_SHA)
    assert.equal(JSON.parse(readFileSync(proofPath, 'utf8')).targetReleaseSha, OTHER_SHA)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('fresh approval cannot replace an active unused proof or unknown schema', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-no-replace-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const now = Date.now()
  const first = issueFixture({ now, commentId: '6736686769' })
  const second = issueFixture({ now, commentId: '6736686770', issuanceRunId: '800000002', attestationId: '550e8400-e29b-41d4-a716-446655440001' })
  try {
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: first.payloadBase64, workflowRunId: '800000001', now })
    const original = readFileSync(proofPath, 'utf8')
    assert.throws(
      () => issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: second.payloadBase64, workflowRunId: '800000002', now }),
      /ACTIVE_ATTESTATION_NOT_CONSUMED/,
    )
    assert.equal(readFileSync(proofPath, 'utf8'), original)

    const otherProofPath = path.join(dir, '.unknown-attestation.json')
    writeFileSync(otherProofPath, JSON.stringify(validAttestation()), { mode: 0o600 })
    assert.throws(
      () => issueRiskAcceptance({ attestationPath: otherProofPath, deploySha: DEPLOY_SHA, payloadBase64: second.payloadBase64, workflowRunId: '800000002', now }),
      /EXISTING_ATTESTATION_UNKNOWN_REFUSING_REPLACEMENT/,
    )
    assert.equal(JSON.parse(readFileSync(otherProofPath, 'utf8')).schemaVersion, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema v3 refuses expired proof and missing or mismatched issuance records', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-invalid-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const now = Date.now()
  const expired = issueFixture({ now: now - 60 * 60_000 })
  try {
    assert.throws(
      () => issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: expired.payloadBase64, workflowRunId: '800000001', now }),
      /ATTESTATION_EXPIRED/,
    )
    const fixture = issueFixture({ now })
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: fixture.payloadBase64, workflowRunId: '800000001', now })
    writeFileSync(`${proofPath}.state/issued/6736686769.json`, '{"unknown":true}')
    assert.throws(
      () => consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000020', runAttempt: '1', now }),
      /ISSUANCE_RECORD_MISMATCH/,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('schema v3 consumption requires a private proof file on POSIX production hosts', () => {
  if (process.platform === 'win32') return
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v3-permissions-'))
  const proofPath = path.join(dir, '.backup-verification.json')
  const fixture = issueFixture()
  try {
    issueRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, payloadBase64: fixture.payloadBase64, workflowRunId: '800000001', now: fixture.now })
    chmodSync(proofPath, 0o640)
    assert.throws(
      () => consumeRiskAcceptance({ attestationPath: proofPath, deploySha: DEPLOY_SHA, runId: '900000050', runAttempt: '1', now: fixture.now }),
      /ATTESTATION_PRIVATE_FILE_PERMISSIONS_REQUIRED/,
    )
    assert.throws(() => lstatSync(`${proofPath}.state/consumed/6736686769.json`), { code: 'ENOENT' }, 'bad file mode must not consume the proof')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('consume preserves schema v1 and v2 verify semantics and does not create v3 state', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ecfc-risk-v12-'))
  try {
    for (const [name, data] of [['v1', validAttestation()], ['v2', validWaiver()]] as const) {
      const file = path.join(dir, `${name}.json`)
      writeFileSync(file, JSON.stringify(data))
      chmodSync(file, 0o600)
      const args = [
        GATE_PATH, '--cli', 'consume', '--attestation', file, '--deploy-sha', DEPLOY_SHA,
        '--waiver-mode', 'approved', '--risk-acceptance-mode', 'approved', '--run-id', '900000030', '--run-attempt', '1', '--now', NOW_ISO,
      ]
      const result = spawnSync(process.execPath, args, { encoding: 'utf8' })
      assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`)
      assert.match(result.stdout, /^BACKUP_GATE=VERIFIED$/m)
      assert.doesNotMatch(result.stdout, /^RISK_ACCEPTANCE_CONSUMED=YES$/m)
      assert.throws(() => lstatSync(`${file}.state`), { code: 'ENOENT' }, `${name} must not create one-time state`)
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
