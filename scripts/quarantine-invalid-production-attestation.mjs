#!/usr/bin/env node

import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { verifyBackupAttestation } from './production-backup-gate.mjs'

export const CANDIDATE = Object.freeze({
  sourcePath: '/home/apps/easonfansclub/shared/.backup-verification.json',
  targetSha: '80b62a5938aba4d2b50075ed0ed55da169c94f4d',
  proofSha256: 'b7c50aad63c213282ab5b7bc962b24b0461b3723f01e62a72eec11203702460c',
  sizeBytes: 705,
  mode: 0o600,
  ownerUid: 1000,
  mtimeUtc: '2026-11-08T19:46:45.018Z',
  expiresAt: '2026-11-09T07:46:00.000Z',
  diagnosticRunId: '42639322826',
  diagnosticClassification: 'SCHEMA_V3_INVALID',
  diagnosticFormatReason: 'V3_FIELDS_INVALID',
  diagnosticEffectiveStatus: 'INVALID',
  historicalValidationAt: '2026-11-08T19:47:09.000Z',
  historicalApproverDisplay: 'Eason',
})

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'attestationId',
  'issuedByWorkflowRunId',
  'targetReleaseSha',
  'expiresAt',
  'riskAcceptance',
]
const RISK_KEYS = [
  'approvedBy',
  'approvedAt',
  'approvalCommentId',
  'approvalAuthorAssociation',
  'riskStatement',
  'releaseId',
  'noIndependentBackupVerification',
  'noRestoreDrill',
]
const STATE_DIRECTORY_NAMES = ['issued', 'consumed', 'archived']
const HISTORICAL_RUNS = Object.freeze([
  {
    runId: '42515060937',
    conclusion: 'failure',
    result: 'RISK_ACCEPTANCE_NOT_ENABLED; deployment skipped',
  },
  {
    runId: '42516766789',
    conclusion: 'success',
    result: 'schemaVersion=3 risk accepted; database mode=skip-db; target SHA matched',
  },
])

function fail(code) {
  throw new Error(code)
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function safeCode(error, fallback = 'QUARANTINE_FAILED') {
  return /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : fallback
}

function exactKeyDiff(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { missing: [...expected].sort(), unexpected: [] }
  }
  const keys = Object.keys(value)
  return {
    missing: expected.filter(key => !Object.prototype.hasOwnProperty.call(value, key)).sort(),
    unexpected: keys.filter(key => !expected.includes(key)).sort(),
  }
}

export function assertRegularFileMetadata(stats, {
  platform = process.platform,
  expectedMode = CANDIDATE.mode,
  expectedUid = typeof process.getuid === 'function' ? process.getuid() : undefined,
} = {}) {
  if (!stats.isFile() || (typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink())) {
    fail('SOURCE_NOT_REGULAR_FILE')
  }
  if (platform !== 'win32') {
    if ((stats.mode & 0o777) !== expectedMode) fail('SOURCE_MODE_MISMATCH')
    if (expectedUid !== undefined && stats.uid !== expectedUid) fail('SOURCE_OWNER_MISMATCH')
  }
}

function assertDirectoryMetadata(stats, { platform, expectedUid }) {
  if (!stats.isDirectory() || (typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink())) {
    fail('STATE_PATH_NOT_REGULAR_DIRECTORY')
  }
  if (platform !== 'win32') {
    if ((stats.mode & 0o777) !== 0o700) fail('STATE_DIRECTORY_MODE_UNSAFE')
    if (expectedUid !== undefined && stats.uid !== expectedUid) fail('STATE_DIRECTORY_OWNER_MISMATCH')
  }
}

function lstatIfPresent(fsImpl, path) {
  try {
    return fsImpl.lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function assertNoSymlinkPathSegments(fsImpl, sourcePath, platform) {
  if (platform === 'win32') return
  const parts = sourcePath.split('/').filter(Boolean)
  let current = '/'
  const rootStats = fsImpl.lstatSync(current)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) fail('PATH_SEGMENT_NOT_DIRECTORY')
  for (const part of parts.slice(0, -1)) {
    current = join(current, part)
    const stats = fsImpl.lstatSync(current)
    if (!stats.isDirectory() || stats.isSymbolicLink()) fail('PATH_SEGMENT_NOT_DIRECTORY')
  }
}

function metadata(stats, digest) {
  return {
    fileType: 'REGULAR_FILE',
    sizeBytes: stats.size,
    mode: (stats.mode & 0o777).toString(8).padStart(4, '0'),
    ownerUid: typeof stats.uid === 'number' ? stats.uid : null,
    groupGid: typeof stats.gid === 'number' ? stats.gid : null,
    device: typeof stats.dev === 'number' ? stats.dev : null,
    inode: typeof stats.ino === 'number' ? stats.ino : null,
    mtimeUtc: stats.mtime.toISOString(),
    ctimeUtc: stats.ctime.toISOString(),
    atimeUtc: stats.atime.toISOString(),
    sha256: digest,
  }
}

function syncDirectory(fsImpl, directoryPath, platform) {
  if (platform === 'win32') return
  const flags = fsImpl.constants.O_RDONLY | (fsImpl.constants.O_DIRECTORY ?? 0) |
    (fsImpl.constants.O_NOFOLLOW ?? 0)
  const fd = fsImpl.openSync(directoryPath, flags)
  try {
    fsImpl.fsyncSync(fd)
  } finally {
    fsImpl.closeSync(fd)
  }
}

function createExclusiveJson(fsImpl, filePath, value, directoryPath, platform) {
  const flags = fsImpl.constants.O_WRONLY | fsImpl.constants.O_CREAT | fsImpl.constants.O_EXCL |
    (fsImpl.constants.O_NOFOLLOW ?? 0) | (fsImpl.constants.O_CLOEXEC ?? 0)
  const fd = fsImpl.openSync(filePath, flags, 0o600)
  try {
    fsImpl.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8')
    fsImpl.fsyncSync(fd)
  } finally {
    fsImpl.closeSync(fd)
  }
  syncDirectory(fsImpl, directoryPath, platform)
  const stats = fsImpl.lstatSync(filePath)
  if (!stats.isFile() || stats.isSymbolicLink() || (platform !== 'win32' && (stats.mode & 0o777) !== 0o600)) {
    fail('AUDIT_RECORD_METADATA_INVALID')
  }
  return sha256(fsImpl.readFileSync(filePath))
}

function readCandidate(fsImpl, sourcePath, options) {
  const initialLstat = fsImpl.lstatSync(sourcePath)
  assertRegularFileMetadata(initialLstat, options)
  const noFollow = fsImpl.constants.O_NOFOLLOW ?? 0
  const noAtime = fsImpl.constants.O_NOATIME ?? 0
  if (options.platform !== 'win32' && noFollow === 0) fail('NOFOLLOW_UNAVAILABLE')
  if (options.platform !== 'win32' && noAtime === 0) fail('NOATIME_UNAVAILABLE')
  const fd = fsImpl.openSync(sourcePath, fsImpl.constants.O_RDONLY | noFollow | noAtime)
  try {
    const opened = fsImpl.fstatSync(fd)
    assertRegularFileMetadata(opened, options)
    if (opened.dev !== initialLstat.dev || opened.ino !== initialLstat.ino) fail('SOURCE_CHANGED_DURING_OPEN')
    const bytes = fsImpl.readFileSync(fd)
    const afterRead = fsImpl.fstatSync(fd)
    if (afterRead.dev !== opened.dev || afterRead.ino !== opened.ino ||
        afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs) {
      fail('SOURCE_CHANGED_DURING_READ')
    }
    return { bytes, stats: afterRead, digest: sha256(bytes) }
  } finally {
    fsImpl.closeSync(fd)
  }
}

function validateCandidate(bytes, now, expected) {
  if (sha256(bytes) !== expected.proofSha256) fail('SOURCE_SHA256_MISMATCH')
  if (bytes.length !== expected.sizeBytes) fail('SOURCE_SIZE_MISMATCH')

  let data
  try {
    data = JSON.parse(bytes.toString('utf8'))
  } catch {
    fail('SOURCE_JSON_INVALID')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('SOURCE_JSON_SHAPE_INVALID')
  if (data.schemaVersion !== 3) fail('SOURCE_SCHEMA_MISMATCH')
  if (data.targetReleaseSha !== expected.targetSha) fail('SOURCE_TARGET_SHA_MISMATCH')
  if (Date.parse(data.expiresAt) !== Date.parse(expected.expiresAt)) fail('SOURCE_EXPIRY_MISMATCH')
  if (!Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) > now) {
    fail('SOURCE_PROOF_NOT_EXPIRED')
  }
  if (data.riskAcceptance?.approvedBy !== expected.historicalApproverDisplay) {
    fail('SOURCE_HISTORICAL_IDENTITY_MISMATCH')
  }

  const topDiff = exactKeyDiff(data, TOP_LEVEL_KEYS)
  const riskDiff = exactKeyDiff(data.riskAcceptance, RISK_KEYS)
  if (!topDiff.missing.length && !topDiff.unexpected.length &&
      !riskDiff.missing.length && !riskDiff.unexpected.length) {
    fail('SOURCE_FIELDS_MATCH_EXPECTED_SCHEMA')
  }

  const historical = verifyBackupAttestation(bytes.toString('utf8'), {
    deploySha: expected.targetSha,
    now: Date.parse(expected.historicalValidationAt),
    allowRiskAcceptance: true,
  })
  if (historical.ok) fail('SOURCE_VALID_UNDER_CURRENT_GATE')

  return {
    schemaVersion: 3,
    targetReleaseSha: data.targetReleaseSha,
    expiresAt: data.expiresAt,
    currentGateValidationReason: safeCode({ message: historical.reason }, 'CURRENT_GATE_REJECTED'),
    formatDiff: {
      topLevelMissingKeys: topDiff.missing,
      topLevelUnexpectedKeys: topDiff.unexpected,
      riskAcceptanceMissingKeys: riskDiff.missing,
      riskAcceptanceUnexpectedKeys: riskDiff.unexpected,
    },
  }
}

function assertFixedDiagnosticEvidence(expected) {
  if (expected.diagnosticRunId !== CANDIDATE.diagnosticRunId ||
      expected.diagnosticClassification !== CANDIDATE.diagnosticClassification ||
      expected.diagnosticFormatReason !== CANDIDATE.diagnosticFormatReason ||
      expected.diagnosticEffectiveStatus !== CANDIDATE.diagnosticEffectiveStatus) {
    fail('DIAGNOSTIC_EVIDENCE_MISMATCH')
  }
}

function assertStateDirectories(fsImpl, statePath, options) {
  assertNoSymlinkPathSegments(fsImpl, statePath, options.platform)
  const rootStats = fsImpl.lstatSync(statePath)
  assertDirectoryMetadata(rootStats, options)
  const rootEntries = fsImpl.readdirSync(statePath).sort()
  if (rootEntries.join('|') !== [...STATE_DIRECTORY_NAMES].sort().join('|')) {
    fail('STATE_DIRECTORY_LAYOUT_MISMATCH')
  }
  const directories = {}
  for (const name of STATE_DIRECTORY_NAMES) {
    const path = join(statePath, name)
    const stats = fsImpl.lstatSync(path)
    assertDirectoryMetadata(stats, options)
    const entries = fsImpl.readdirSync(path)
    if (name !== 'archived' && entries.length !== 0) fail('STATE_RECORDS_PRESENT')
    directories[name] = path
  }
  return directories
}

export function performQuarantine({
  sourcePath,
  statePath = sourcePath + '.state',
  expected = CANDIDATE,
  runId,
  runAttempt,
  lockHeld,
  now = Date.now(),
  fsImpl = fs,
  platform = process.platform,
  processUid = typeof process.getuid === 'function' ? process.getuid() : undefined,
}) {
  if (lockHeld !== true) fail('PRODUCTION_LOCK_NOT_HELD')
  if (!/^[1-9][0-9]{0,19}$/.test(String(runId ?? ''))) fail('QUARANTINE_RUN_ID_INVALID')
  if (!/^[1-9][0-9]{0,5}$/.test(String(runAttempt ?? ''))) fail('QUARANTINE_RUN_ATTEMPT_INVALID')
  assertFixedDiagnosticEvidence(expected)
  assertNoSymlinkPathSegments(fsImpl, sourcePath, platform)
  const stateDirectories = assertStateDirectories(fsImpl, statePath, { platform, expectedUid: processUid })

  const proofArchivePath = join(stateDirectories.archived, 'historical-invalid-' + expected.proofSha256 + '.json')
  const auditPath = proofArchivePath + '.quarantine.json'
  const completionPath = proofArchivePath + '.complete.json'
  if (lstatIfPresent(fsImpl, proofArchivePath) || lstatIfPresent(fsImpl, auditPath) ||
      lstatIfPresent(fsImpl, completionPath)) {
    fail('QUARANTINE_ARCHIVE_CONFLICT')
  }

  const sourceOptions = {
    platform,
    expectedMode: expected.mode,
    expectedUid: processUid,
  }
  const candidate = readCandidate(fsImpl, sourcePath, sourceOptions)
  if (candidate.digest !== expected.proofSha256) fail('SOURCE_SHA256_MISMATCH')
  if (candidate.stats.size !== expected.sizeBytes) fail('SOURCE_SIZE_MISMATCH')
  if (platform !== 'win32' && candidate.stats.uid !== expected.ownerUid) fail('SOURCE_DIAGNOSTIC_OWNER_MISMATCH')
  if (candidate.stats.mtime.toISOString() !== expected.mtimeUtc) fail('SOURCE_MTIME_MISMATCH')
  const evidence = validateCandidate(candidate.bytes, now, expected)

  const audit = {
    schemaVersion: 1,
    status: 'QUARANTINE_PREPARED',
    operation: 'QUARANTINE_EXACT_INVALID_SCHEMA_V3_PROOF',
    operationRunId: String(runId),
    operationRunAttempt: String(runAttempt),
    diagnostic: {
      runId: expected.diagnosticRunId,
      classification: expected.diagnosticClassification,
      formatReason: expected.diagnosticFormatReason,
      effectiveStatus: expected.diagnosticEffectiveStatus,
    },
    historicalUse: 'CONFIRMED_BY_DEPLOY_WORKFLOW_LOG',
    historicalRuns: HISTORICAL_RUNS,
    proof: {
      sha256: candidate.digest,
      targetReleaseSha: expected.targetSha,
      schemaVersion: evidence.schemaVersion,
      expiresAt: evidence.expiresAt,
      currentGateValidationReason: evidence.currentGateValidationReason,
      formatDiff: evidence.formatDiff,
    },
    sourcePath,
    archivePath: proofArchivePath,
    sourceMetadataBefore: metadata(candidate.stats, candidate.digest),
    preparedAt: new Date(now).toISOString(),
    completionRecord: completionPath,
    note: 'The proof was used by historical deployment run 42516766789. Empty current state ledgers are not evidence that it was never used.',
  }
  const auditSha256 = createExclusiveJson(fsImpl, auditPath, audit, stateDirectories.archived, platform)

  // linkSync is atomic and refuses an existing destination. The source remains
  // until the archived link is verified to be the same inode and byte hash.
  fsImpl.linkSync(sourcePath, proofArchivePath)
  const archived = readCandidate(fsImpl, proofArchivePath, sourceOptions)
  if (archived.digest !== candidate.digest || archived.stats.dev !== candidate.stats.dev ||
      archived.stats.ino !== candidate.stats.ino || archived.stats.mode !== candidate.stats.mode ||
      archived.stats.uid !== candidate.stats.uid || archived.stats.mtimeMs !== candidate.stats.mtimeMs) {
    fail('ARCHIVE_READBACK_METADATA_MISMATCH')
  }

  const sourceNow = fsImpl.lstatSync(sourcePath)
  const archiveBeforeUnlink = readCandidate(fsImpl, proofArchivePath, sourceOptions)
  if (sourceNow.dev !== candidate.stats.dev || sourceNow.ino !== candidate.stats.ino ||
      archiveBeforeUnlink.digest !== expected.proofSha256 ||
      archiveBeforeUnlink.stats.dev !== candidate.stats.dev || archiveBeforeUnlink.stats.ino !== candidate.stats.ino) {
    fail('SOURCE_CHANGED_BEFORE_UNLINK')
  }
  fsImpl.unlinkSync(sourcePath)
  syncDirectory(fsImpl, join(sourcePath, '..'), platform)
  syncDirectory(fsImpl, stateDirectories.archived, platform)
  if (lstatIfPresent(fsImpl, sourcePath)) fail('SOURCE_STILL_PRESENT_AFTER_QUARANTINE')

  const archiveFinal = readCandidate(fsImpl, proofArchivePath, sourceOptions)
  if (archiveFinal.digest !== expected.proofSha256 || archiveFinal.stats.dev !== candidate.stats.dev ||
      archiveFinal.stats.ino !== candidate.stats.ino || archiveFinal.stats.mode !== candidate.stats.mode ||
      archiveFinal.stats.uid !== candidate.stats.uid || archiveFinal.stats.mtimeMs !== candidate.stats.mtimeMs) {
    fail('ARCHIVE_FINAL_VERIFICATION_FAILED')
  }
  const completion = {
    schemaVersion: 1,
    status: 'QUARANTINED',
    operationRunId: String(runId),
    operationRunAttempt: String(runAttempt),
    proofSha256: expected.proofSha256,
    targetReleaseSha: expected.targetSha,
    archivePath: proofArchivePath,
    archiveMetadataAfter: metadata(archiveFinal.stats, archiveFinal.digest),
    originalMetadataPreserved: {
      bytes: true,
      permissions: true,
      owner: true,
      mtime: true,
      inode: true,
    },
    auditRecordSha256: auditSha256,
    completedAt: new Date(now).toISOString(),
  }
  const completionSha256 = createExclusiveJson(
    fsImpl,
    completionPath,
    completion,
    stateDirectories.archived,
    platform,
  )

  return {
    status: 'QUARANTINED',
    proofSha256: expected.proofSha256,
    targetReleaseSha: expected.targetSha,
    archivePath: proofArchivePath,
    auditPath,
    completionPath,
    auditSha256,
    completionSha256,
    historicalRunId: '42516766789',
  }
}

function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--cli' || process.argv[3] !== 'quarantine') {
    fail('CLI_COMMAND_INVALID')
  }
  const result = performQuarantine({
    sourcePath: CANDIDATE.sourcePath,
    statePath: CANDIDATE.sourcePath + '.state',
    expected: CANDIDATE,
    runId: process.env.QUARANTINE_RUN_ID,
    runAttempt: process.env.QUARANTINE_RUN_ATTEMPT,
    lockHeld: process.env.QUARANTINE_LOCK_HELD === 'YES',
  })
  process.stdout.write('QUARANTINE_STATUS=' + result.status + '\n')
  process.stdout.write('QUARANTINE_PROOF_SHA256=' + result.proofSha256 + '\n')
  process.stdout.write('QUARANTINE_TARGET_SHA=' + result.targetReleaseSha + '\n')
  process.stdout.write('QUARANTINE_AUDIT_SHA256=' + result.auditSha256 + '\n')
  process.stdout.write('QUARANTINE_COMPLETION_SHA256=' + result.completionSha256 + '\n')
  process.stdout.write('HISTORICAL_USE_CONFIRMED_RUN_ID=' + result.historicalRunId + '\n')
}

if (basename(process.argv[1] ?? '') === 'quarantine-invalid-production-attestation.mjs' &&
    process.argv.includes('--cli')) {
  try {
    main()
  } catch (error) {
    process.stderr.write('QUARANTINE_STATUS=REJECTED reason=' + safeCode(error) + '\n')
    process.exitCode = 1
  }
}
