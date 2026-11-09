import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  ATTESTATION_PATH,
  STATE_PATH,
  diagnoseAttestationAt,
} from '../scripts/diagnose-production-attestation.mjs'

const NOW = Date.parse('2026-11-09T10:00:00.000Z')
const TARGET_SHA = 'c1e2b1cc844c3b4fab5f609a9dfb927c8c803546'
const COMMENT_ID = '6741233172'
const ATTESTATION_ID = 'a8d80c25-e06e-4fee-b302-1155c65fb85a'

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ecfc-attestation-diagnostic-'))
  const attestationPath = path.join(root, '.backup-verification.json')
  const statePath = `${attestationPath}.state`
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, attestationPath, statePath }
}

function riskAcceptance(overrides = {}) {
  return {
    approvedBy: 'andkdiids',
    approvedAt: '2026-11-09T09:45:00.000Z',
    approvalCommentId: COMMENT_ID,
    approvalAuthorAssociation: 'OWNER',
    riskStatement: 'No independent backup/PITR verification and no isolated restore drill; serious failure could cause permanent data loss.',
    releaseId: TARGET_SHA,
    noIndependentBackupVerification: true,
    noRestoreDrill: true,
    ...overrides,
  }
}

function v3Proof(overrides = {}) {
  return {
    schemaVersion: 3,
    attestationId: ATTESTATION_ID,
    issuedByWorkflowRunId: '42627921767',
    targetReleaseSha: TARGET_SHA,
    expiresAt: '2026-11-09T10:30:00.000Z',
    riskAcceptance: riskAcceptance(),
    ...overrides,
  }
}

function writeProof(filePath, proof, mode = 0o600) {
  const text = `${JSON.stringify(proof, null, 2)}\n`
  writeFileSync(filePath, text, { mode })
  return text
}

function baseReport(paths, now = NOW) {
  return diagnoseAttestationAt({ ...paths, now, testOnlyAllowNoFollowFallback: true })
}

test('uses only the fixed production paths and has no production write or signer entry point', () => {
  const workflow = readFileSync('.github/workflows/diagnose-production-attestation.yml', 'utf8')
  const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8')
  const source = readFileSync('scripts/diagnose-production-attestation.mjs', 'utf8')
  const fsImport = source.match(/import\s*\{([\s\S]*?)\}\s*from 'node:fs'/)?.[1] ?? ''
  const deployIgnore = deploy.match(/paths-ignore:\s*([\s\S]*?)\n\s+workflow_dispatch:/)?.[1] ?? ''

  assert.equal(ATTESTATION_PATH, '/home/apps/easonfansclub/shared/.backup-verification.json')
  assert.equal(STATE_PATH, `${ATTESTATION_PATH}.state`)
  assert.match(workflow, /workflow_dispatch:\s*\n\s*$/m)
  assert.doesNotMatch(workflow, /workflow_dispatch:\s*\n\s+inputs:/)
  assert.doesNotMatch(workflow, /github\.event\.inputs|\$\{\{\s*inputs\./)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /environment:\s*\n\s+name: Production/)
  assert.match(workflow, /group: production-deploy[\s\S]*?cancel-in-progress: false/)
  assert.match(workflow, /StrictHostKeyChecking=yes/)
  assert.match(workflow, /flock -s -n 9/)
  assert.match(workflow, /exec 9< "\$lock"/)
  assert.ok(workflow.includes('NVM_DIR="${HOME}/.nvm"'))
  assert.ok(workflow.includes('node_real="$(/usr/bin/readlink -f -- "$node_bin")"'))
  assert.ok(workflow.includes('env -i PATH="$node_dir:/usr/bin:/bin" LANG=C "$node_real"'))
  assert.doesNotMatch(workflow, /\/usr\/bin\/node --input-type=module/)
  assert.doesNotMatch(workflow, /StrictHostKeyChecking=no|ssh-keyscan|issueRiskAcceptance|archiveExistingRiskAcceptance|consumeRiskAcceptance|ensureStateLayout|migrate deploy|deploy-production-git/)
  assert.match(deployIgnore, /'scripts\/diagnose-production-attestation\.mjs'/)
  assert.match(deployIgnore, /'tests\/production-attestation-diagnostic\.test\.mjs'/)
  assert.doesNotMatch(source, /process\.argv\.slice|parseArgs|process\.env\.(?:ATTESTATION|STATE|PATH|FILE)/)
  assert.match(fsImport, /constants/)
  assert.match(fsImport, /lstatSync/)
  assert.match(fsImport, /readFileSync/)
  assert.doesNotMatch(fsImport, /writeFile|mkdir|unlink|rename|chmod|chown|truncate|rmSync/)
  assert.doesNotMatch(source, /node:child_process|\beval\s*\(/)
})

test('reports a missing proof and never creates its state tree', (t) => {
  const paths = fixture(t)
  const before = readdirSync(paths.root)
  const report = baseReport(paths)
  assert.equal(report.ATTESTATION_CLASSIFICATION, 'MISSING_FILE')
  assert.equal(report.ATTESTATION_FILE_SHA256, 'UNKNOWN')
  assert.equal(report.STATE_DIRECTORY_STATUS, 'MISSING')
  assert.equal(report.ISSUANCE_RECORD_STATUS, 'UNLINKED_NO_V3_KEYS')
  assert.equal(existsSync(paths.statePath), false)
  assert.deepEqual(readdirSync(paths.root), before)
})

test('classifies schema v1 and v2 without treating their contents as safe to replace', (t) => {
  const paths = fixture(t)
  const v1 = {
    schemaVersion: 1,
    backupId: 'snapshot-123',
    backupType: 'AUTOMATED_SNAPSHOT',
    backupCompletedAt: '2026-11-09T08:00:00.000Z',
    pitrAvailable: true,
    pitrRetentionDays: 7,
    restoreDrillVerified: true,
    restoreDrillAt: '2026-11-09T08:30:00.000Z',
    verifiedBy: 'release-operator',
    targetReleaseSha: TARGET_SHA,
    expiresAt: '2026-11-09T11:00:00.000Z',
  }
  writeProof(paths.attestationPath, v1)
  assert.equal(baseReport(paths).ATTESTATION_CLASSIFICATION, 'LEGACY_SCHEMA_V1')
  assert.equal(baseReport(paths).ATTESTATION_FORMAT_VALID, 'YES')

  const v2 = {
    schemaVersion: 2,
    backupId: 'snapshot-456',
    backupType: 'AUTOMATED_SNAPSHOT',
    backupCompletedAt: '2026-11-09T08:00:00.000Z',
    pitrAvailable: true,
    pitrRetentionDays: 7,
    verifiedBy: 'release-operator',
    targetReleaseSha: TARGET_SHA,
    expiresAt: '2026-11-09T11:00:00.000Z',
    restoreDrillWaiver: {
      approvedBy: 'andkdiids',
      approvedAt: '2026-11-09T08:30:00.000Z',
      riskStatement: 'Restore drill was not performed for this one release.',
      releaseId: TARGET_SHA,
    },
  }
  writeProof(paths.attestationPath, v2)
  assert.equal(baseReport(paths).ATTESTATION_CLASSIFICATION, 'LEGACY_SCHEMA_V2')
  assert.equal(baseReport(paths).ATTESTATION_FORMAT_VALID, 'YES')
  assert.equal(baseReport(paths).PROOF_EFFECTIVE_STATUS, 'LEGACY_REQUIRES_PRODUCTION_GATE_VALIDATION')
})

test('classifies malformed JSON, unknown schemas, and invalid schema v3 precisely', (t) => {
  const paths = fixture(t)
  writeFileSync(paths.attestationPath, '{broken', { mode: 0o600 })
  assert.equal(baseReport(paths).ATTESTATION_CLASSIFICATION, 'INVALID_JSON')

  writeProof(paths.attestationPath, { schemaVersion: 99, targetReleaseSha: TARGET_SHA })
  assert.equal(baseReport(paths).ATTESTATION_CLASSIFICATION, 'UNKNOWN_FORMAT')

  writeProof(paths.attestationPath, v3Proof({ backupId: 'fabricated' }))
  assert.equal(baseReport(paths).ATTESTATION_CLASSIFICATION, 'SCHEMA_V3_INVALID')
  assert.equal(baseReport(paths).ATTESTATION_FORMAT_REASON, 'V3_FIELDS_INVALID')
})

test('validates v3 issuance and consumption records by hash without exposing proof fields', (t) => {
  const paths = fixture(t)
  const proof = v3Proof({ riskAcceptance: riskAcceptance({ riskStatement: 'PRIVATE_SENTINEL should never appear in diagnostic output.' }) })
  const proofText = writeProof(paths.attestationPath, proof)
  const proofHash = createHash('sha256').update(proofText).digest('hex')
  mkdirSync(path.join(paths.statePath, 'issued'), { recursive: true, mode: 0o700 })
  mkdirSync(path.join(paths.statePath, 'consumed'), { recursive: true, mode: 0o700 })
  mkdirSync(path.join(paths.statePath, 'archived'), { recursive: true, mode: 0o700 })
  const issuance = {
    schemaVersion: 1,
    targetReleaseSha: TARGET_SHA,
    approvalCommentId: COMMENT_ID,
    approvedBy: 'andkdiids',
    approvalAuthorAssociation: 'OWNER',
    approvedAt: proof.riskAcceptance.approvedAt,
    attestationId: ATTESTATION_ID,
    issuedByWorkflowRunId: '42627921767',
    issuedAt: '2026-11-09T09:50:00.000Z',
    proofSha256: proofHash,
  }
  writeFileSync(path.join(paths.statePath, 'issued', `${COMMENT_ID}.json`), `${JSON.stringify(issuance, null, 2)}\n`, { mode: 0o600 })

  let report = baseReport(paths)
  assert.equal(report.ATTESTATION_CLASSIFICATION, 'SCHEMA_V3_VALID')
  assert.equal(report.ATTESTATION_TARGET_SHA, TARGET_SHA)
  assert.equal(report.ATTESTATION_EXPIRES_AT, '2026-11-09T10:30:00.000Z')
  assert.equal(report.RISK_ACCEPTANCE_FIELD_PRESENT, 'YES')
  assert.equal(report.ISSUANCE_RECORD_STATUS, 'VALID')
  assert.equal(report.ISSUANCE_RECORD_FILE_TYPE, 'REGULAR_FILE')
  assert.match(report.ISSUANCE_RECORD_MODE, /^0[0-7]{3,4}$/)
  assert.match(report.ISSUANCE_RECORD_OWNER_UID, /^(?:[0-9]+|UNKNOWN)$/)
  assert.match(report.ISSUANCE_RECORD_OWNER_MATCHES_PROCESS, /^(?:YES|NO|UNKNOWN)$/)
  assert.match(report.ISSUED_DIRECTORY_MODE, /^0[0-7]{3,4}$/)
  assert.equal(report.CONSUMPTION_RECORD_STATUS, 'MISSING')
  assert.equal(report.ARCHIVE_RECORD_STATUS, 'ABSENT')
  assert.equal(report.PROOF_EFFECTIVE_STATUS, 'ACTIVE_UNCONSUMED')
  assert.equal(JSON.stringify(report).includes('PRIVATE_SENTINEL'), false)
  assert.equal(JSON.stringify(report).includes('No independent backup'), false)

  const consumption = {
    schemaVersion: 1,
    targetReleaseSha: TARGET_SHA,
    runId: '42627921767',
    runAttempt: '1',
    attestationId: ATTESTATION_ID,
    approvalCommentId: COMMENT_ID,
    approvedBy: 'andkdiids',
    approvedAt: proof.riskAcceptance.approvedAt,
    proofSha256: proofHash,
    consumedAt: '2026-11-09T09:55:00.000Z',
  }
  writeFileSync(path.join(paths.statePath, 'consumed', `${COMMENT_ID}.json`), `${JSON.stringify(consumption, null, 2)}\n`, { mode: 0o600 })
  report = baseReport(paths)
  assert.equal(report.CONSUMPTION_RECORD_STATUS, 'VALID')
  assert.equal(report.PROOF_EFFECTIVE_STATUS, 'CONSUMED')
})

test('does not follow a proof symlink or state-directory symlink', (t) => {
  const paths = fixture(t)
  const target = path.join(paths.root, 'outside.json')
  writeProof(target, v3Proof())
  try {
    symlinkSync(target, paths.attestationPath)
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip('symlink creation is unavailable on this host')
    throw error
  }
  const report = baseReport(paths)
  assert.equal(report.ATTESTATION_FILE_TYPE, 'UNSAFE_SYMLINK')
  assert.equal(report.ATTESTATION_FILE_SHA256, 'UNKNOWN')
  assert.equal(report.ATTESTATION_CLASSIFICATION, 'UNKNOWN_FORMAT')

  rmSync(paths.attestationPath)
  mkdirSync(paths.statePath, { recursive: true })
  const externalState = path.join(paths.root, 'external-state')
  mkdirSync(externalState)
  rmSync(paths.statePath, { recursive: true })
  symlinkSync(externalState, paths.statePath, 'dir')
  const stateReport = baseReport(paths)
  assert.equal(stateReport.STATE_DIRECTORY_STATUS, 'UNSAFE_SYMLINK')
  assert.equal(stateReport.ISSUED_DIRECTORY_STATUS, 'UNSAFE_SYMLINK')
})

test('reports file metadata and a stable hash while leaving every fixture entry unchanged', (t) => {
  const paths = fixture(t)
  const proofText = writeProof(paths.attestationPath, v3Proof())
  const stateBefore = readdirSync(paths.root).sort()
  const expectedHash = createHash('sha256').update(proofText).digest('hex')
  const report = baseReport(paths)
  assert.equal(report.ATTESTATION_FILE_SHA256, expectedHash)
  assert.equal(report.ATTESTATION_SIZE_BYTES, String(Buffer.byteLength(proofText)))
  assert.equal(report.PRODUCTION_FILES_MUTATED, 'NO')
  assert.deepEqual(readdirSync(paths.root).sort(), stateBefore)
  assert.equal(existsSync(paths.statePath), false)
})
