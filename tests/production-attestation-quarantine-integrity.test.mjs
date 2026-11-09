import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyQuarantineArchive } from '../scripts/verify-production-quarantine-archive.mjs'

const HISTORICAL_RUNS = [
  { runId: '42515060937', conclusion: 'failure', result: 'RISK_ACCEPTANCE_NOT_ENABLED; deployment skipped' },
  { runId: '42516766789', conclusion: 'success', result: 'schemaVersion=3 risk accepted; database mode=skip-db; target SHA matched' },
]
const RUN_STARTED = '2026-11-09T16:16:00.000Z'
const RUN_COMPLETED = '2026-11-09T16:16:20.000Z'
const PROOF_MTIME = '2026-11-08T19:46:45.018Z'
const PREPARED_AT = '2026-11-09T16:16:12.000Z'

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function metadataFor(filePath, bytes) {
  const stat = fs.statSync(filePath)
  return {
    fileType: 'REGULAR_FILE',
    sizeBytes: stat.size,
    mode: (stat.mode & 0o777).toString(8).padStart(4, '0'),
    ownerUid: typeof stat.uid === 'number' ? stat.uid : null,
    groupGid: typeof stat.gid === 'number' ? stat.gid : null,
    device: typeof stat.dev === 'number' ? stat.dev : null,
    inode: typeof stat.ino === 'number' ? stat.ino : null,
    mtimeUtc: stat.mtime.toISOString(),
    ctimeUtc: stat.ctime.toISOString(),
    atimeUtc: stat.atime.toISOString(),
    sha256: digest(bytes),
  }
}

function exactFormatDiff(proof) {
  const topKeys = ['schemaVersion', 'attestationId', 'issuedByWorkflowRunId', 'targetReleaseSha', 'expiresAt', 'riskAcceptance']
  const riskKeys = [
    'approvedBy', 'approvedAt', 'approvalCommentId', 'approvalAuthorAssociation', 'riskStatement', 'releaseId',
    'noIndependentBackupVerification', 'noRestoreDrill',
  ]
  const diff = (object, expected) => {
    const keys = object && typeof object === 'object' && !Array.isArray(object) ? Object.keys(object) : []
    return {
      missing: expected.filter(key => !Object.prototype.hasOwnProperty.call(object ?? {}, key)).sort(),
      unexpected: keys.filter(key => !expected.includes(key)).sort(),
    }
  }
  const top = diff(proof, topKeys)
  const risk = diff(proof.riskAcceptance, riskKeys)
  return {
    topLevelMissingKeys: top.missing,
    topLevelUnexpectedKeys: top.unexpected,
    riskAcceptanceMissingKeys: risk.missing,
    riskAcceptanceUnexpectedKeys: risk.unexpected,
  }
}

function writeJson(filePath, value, mtime) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  fs.utimesSync(filePath, new Date(mtime), new Date(mtime))
  return fs.readFileSync(filePath)
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecfc-quarantine-archive-'))
  const sourcePath = path.join(root, 'shared', '.backup-verification.json')
  const statePath = sourcePath + '.state'
  const archiveDir = path.join(statePath, 'archived')
  fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 })
  fs.mkdirSync(path.join(statePath, 'issued'), { mode: 0o700 })
  fs.mkdirSync(path.join(statePath, 'consumed'), { mode: 0o700 })
  for (const dir of [path.dirname(sourcePath), statePath, archiveDir, path.join(statePath, 'issued'), path.join(statePath, 'consumed')]) {
    fs.chmodSync(dir, 0o700)
  }

  const targetSha = '80b62a5938aba4d2b50075ed0ed55da169c94f4d'
  const proof = {
    schemaVersion: 3,
    targetReleaseSha: targetSha,
    expiresAt: '2026-11-09T07:46:00.000Z',
    riskAcceptance: { approvedBy: 'Eason' },
    diagnosticOnlyMarker: 'must-not-be-printed',
  }
  const proofBytes = Buffer.from(JSON.stringify(proof))
  const proofSha256 = digest(proofBytes)
  const expected = {
    sourcePath,
    statePath,
    proofSha256,
    proofSizeBytes: proofBytes.length,
    proofMode: 0o600,
    ownerUid: typeof process.getuid === 'function' ? process.getuid() : null,
    proofMtimeUtc: PROOF_MTIME,
    targetSha,
    proofExpiresAt: proof.expiresAt,
    diagnosticRunId: '42639322826',
    diagnosticClassification: 'SCHEMA_V3_INVALID',
    diagnosticFormatReason: 'V3_FIELDS_INVALID',
    diagnosticEffectiveStatus: 'INVALID',
    quarantineRunId: '42653002337',
    quarantineRunAttempt: '1',
    quarantineRunStartedAt: RUN_STARTED,
    quarantineRunCompletedAt: RUN_COMPLETED,
    ownerDisplay: 'Eason',
  }
  const proofPath = path.join(archiveDir, 'historical-invalid-' + proofSha256 + '.json')
  const auditPath = proofPath + '.quarantine.json'
  const completionPath = proofPath + '.complete.json'
  fs.writeFileSync(proofPath, proofBytes, { mode: 0o600, flag: 'wx' })
  fs.utimesSync(proofPath, new Date(PROOF_MTIME), new Date(PROOF_MTIME))
  const proofMetadata = metadataFor(proofPath, proofBytes)
  const audit = {
    schemaVersion: 1,
    status: 'QUARANTINE_PREPARED',
    operation: 'QUARANTINE_EXACT_INVALID_SCHEMA_V3_PROOF',
    operationRunId: expected.quarantineRunId,
    operationRunAttempt: expected.quarantineRunAttempt,
    diagnostic: {
      runId: expected.diagnosticRunId,
      classification: expected.diagnosticClassification,
      formatReason: expected.diagnosticFormatReason,
      effectiveStatus: expected.diagnosticEffectiveStatus,
    },
    historicalUse: 'CONFIRMED_BY_DEPLOY_WORKFLOW_LOG',
    historicalRuns: HISTORICAL_RUNS,
    proof: {
      sha256: proofSha256,
      targetReleaseSha: targetSha,
      schemaVersion: 3,
      expiresAt: proof.expiresAt,
      currentGateValidationReason: 'V3_FIELDS_INVALID',
      formatDiff: exactFormatDiff(proof),
    },
    sourcePath,
    archivePath: proofPath,
    sourceMetadataBefore: proofMetadata,
    preparedAt: PREPARED_AT,
    completionRecord: completionPath,
    note: 'The proof was used by historical deployment run 42516766789. Empty current state ledgers are not evidence that it was never used.',
  }
  const auditBytes = writeJson(auditPath, audit, PREPARED_AT)
  const completion = {
    schemaVersion: 1,
    status: 'QUARANTINED',
    operationRunId: expected.quarantineRunId,
    operationRunAttempt: expected.quarantineRunAttempt,
    proofSha256,
    targetReleaseSha: targetSha,
    archivePath: proofPath,
    archiveMetadataAfter: proofMetadata,
    originalMetadataPreserved: { bytes: true, permissions: true, owner: true, mtime: true, inode: true },
    auditRecordSha256: digest(auditBytes),
    completedAt: PREPARED_AT,
  }
  writeJson(completionPath, completion, PREPARED_AT)
  return { root, expected, archiveDir, proofPath, auditPath, completionPath }
}

function snapshot(directory) {
  return fs.readdirSync(directory).sort().map(name => {
    const full = path.join(directory, name)
    const stat = fs.statSync(full)
    return {
      name,
      sha256: digest(fs.readFileSync(full)),
      size: stat.size,
      mode: stat.mode & 0o777,
      uid: typeof stat.uid === 'number' ? stat.uid : null,
      gid: typeof stat.gid === 'number' ? stat.gid : null,
      dev: typeof stat.dev === 'number' ? stat.dev : null,
      ino: typeof stat.ino === 'number' ? stat.ino : null,
      ctime: stat.ctime.toISOString(),
      mtime: stat.mtime.toISOString(),
    }
  })
}

function verify(fixture) {
  return verifyQuarantineArchive({
    expected: fixture.expected,
    fsImpl: fs,
    platform: process.platform,
    lockHeld: true,
    processUid: fixture.expected.ownerUid,
    enforceProductionRuntime: false,
  })
}

test('accepts the exact complete archive and links all three immutable records', t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const report = verify(fixture)
  assert.equal(report.ARCHIVE_INTEGRITY, 'PASS')
  assert.equal(report.QUARANTINE_RUN_ID_MATCH, 'YES')
  assert.equal(report.TARGET_SHA_MATCH, 'YES')
  assert.equal(report.auditRecordStatus, 'VALID')
  assert.equal(report.proofFile.sha256, fixture.expected.proofSha256)
  assert.equal(report.SAFE_TO_ISSUE_NEW_ATTESTATION, 'YES_AFTER_FRESH_SHA_BOUND_OWNER_APPROVAL')
  assert.doesNotMatch(JSON.stringify(report), /must-not-be-printed/)
})

test('fails closed when any expected archive record is missing', t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  fs.unlinkSync(fixture.completionPath)
  assert.throws(() => verify(fixture), /ARCHIVE_DIRECTORY_ENTRIES_MISMATCH/)
})

test('fails closed when the archived proof hash differs from the diagnosed original', t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const bytes = fs.readFileSync(fixture.proofPath)
  bytes[0] ^= 1
  fs.writeFileSync(fixture.proofPath, bytes, { mode: 0o600 })
  fs.utimesSync(fixture.proofPath, new Date(PROOF_MTIME), new Date(PROOF_MTIME))
  assert.throws(() => verify(fixture), /PROOF_SHA256_MISMATCH/)
})

test('fails closed when the audit record is linked to a different quarantine run', t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const audit = JSON.parse(fs.readFileSync(fixture.auditPath, 'utf8'))
  audit.operationRunId = '42653002338'
  fs.writeFileSync(fixture.auditPath, JSON.stringify(audit, null, 2) + '\n', { mode: 0o600 })
  fs.utimesSync(fixture.auditPath, new Date(PREPARED_AT), new Date(PREPARED_AT))
  assert.throws(() => verify(fixture), /AUDIT_RUN_ID_MISMATCH/)
})

test('repeat verification is idempotent and does not alter archive evidence', t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const before = snapshot(fixture.archiveDir)
  assert.equal(verify(fixture).ARCHIVE_INTEGRITY, 'PASS')
  assert.equal(verify(fixture).ARCHIVE_INTEGRITY, 'PASS')
  assert.deepEqual(snapshot(fixture.archiveDir), before)
})

test('fails closed when the completion record audit hash is wrong', t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const completion = JSON.parse(fs.readFileSync(fixture.completionPath, 'utf8'))
  completion.auditRecordSha256 = '0'.repeat(64)
  fs.writeFileSync(fixture.completionPath, JSON.stringify(completion, null, 2) + '\n', { mode: 0o600 })
  fs.utimesSync(fixture.completionPath, new Date(PREPARED_AT), new Date(PREPARED_AT))
  assert.throws(() => verify(fixture), /COMPLETION_AUDIT_SHA256_MISMATCH/)
})

test('fails closed on unsafe production file permissions', { skip: process.platform !== 'linux' }, t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  fs.chmodSync(fixture.proofPath, 0o644)
  assert.throws(() => verifyQuarantineArchive({
    expected: fixture.expected,
    fsImpl: fs,
    platform: 'linux',
    lockHeld: true,
    processUid: fixture.expected.ownerUid,
    enforceProductionRuntime: false,
  }), /FILE_MODE_MISMATCH/)
})

test('fails closed when an archive record is a symbolic link', { skip: process.platform !== 'linux' }, t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  const linkedPath = fixture.auditPath + '.link'
  fs.symlinkSync(fixture.auditPath, linkedPath)
  fs.unlinkSync(fixture.auditPath)
  fs.renameSync(linkedPath, fixture.auditPath)
  assert.throws(() => verifyQuarantineArchive({
    expected: fixture.expected,
    fsImpl: fs,
    platform: 'linux',
    lockHeld: true,
    processUid: fixture.expected.ownerUid,
    enforceProductionRuntime: false,
  }), /FILE_NOT_REGULAR/)
})

test('the production verifier is fixed-purpose, read-only, and deployment-excluded', () => {
  const verifier = fs.readFileSync(new URL('../scripts/verify-production-quarantine-archive.mjs', import.meta.url), 'utf8')
  const workflow = fs.readFileSync(new URL('../.github/workflows/verify-production-quarantine-archive.yml', import.meta.url), 'utf8')
  const infraCi = fs.readFileSync(new URL('../.github/workflows/android-release-infra-ci.yml', import.meta.url), 'utf8')
  const deploy = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')

  assert.doesNotMatch(verifier, /\b(?:writeFileSync|unlinkSync|renameSync|mkdirSync|chmodSync|copyFileSync|rmSync)\b/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s*(?:push|pull_request):/m)
  assert.match(workflow, /name:\s*Production/)
  assert.match(workflow, /group:\s*production-deploy/)
  assert.match(workflow, /flock -s -n 9/)
  assert.match(workflow, /StrictHostKeyChecking=yes/)
  assert.doesNotMatch(workflow, /^\s*inputs:/m)
  assert.equal(workflow.includes(String.fromCharCode(92) + String.fromCharCode(36) + '{{'), false)
  assert.match(infraCi, /production-attestation-quarantine-integrity\.test\.mjs/)
  assert.match(deploy, /scripts\/verify-production-quarantine-archive\.mjs/)
  assert.match(deploy, /tests\/production-attestation-quarantine-integrity\.test\.mjs/)
})

test('requires the caller to hold the nonblocking shared production lock', t => {
  const fixture = createFixture()
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }))
  assert.throws(() => verifyQuarantineArchive({
    expected: fixture.expected,
    fsImpl: fs,
    platform: process.platform,
    lockHeld: false,
    enforceProductionRuntime: false,
  }), /PRODUCTION_SHARED_LOCK_NOT_HELD/)
})

test('rejects a non-Linux production runtime before reading archive paths', () => {
  assert.throws(() => verifyQuarantineArchive({ lockHeld: true, platform: 'win32' }), /LINUX_READONLY_FLAGS_REQUIRED/)
})
