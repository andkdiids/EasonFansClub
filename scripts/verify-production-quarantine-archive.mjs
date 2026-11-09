#!/usr/bin/env node

import * as fs from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

export const CANDIDATE = Object.freeze({
  sourcePath: '/home/apps/easonfansclub/shared/.backup-verification.json',
  statePath: '/home/apps/easonfansclub/shared/.backup-verification.json.state',
  proofSha256: 'b7c50aad63c213282ab5b7bc962b24b0461b3723f01e62a72eec11203702460c',
  proofSizeBytes: 705,
  proofMode: 0o600,
  ownerUid: 1000,
  proofMtimeUtc: '2026-11-08T19:46:45.018Z',
  targetSha: '80b62a5938aba4d2b50075ed0ed55da169c94f4d',
  proofExpiresAt: '2026-11-09T07:46:00.000Z',
  diagnosticRunId: '42639322826',
  diagnosticClassification: 'SCHEMA_V3_INVALID',
  diagnosticFormatReason: 'V3_FIELDS_INVALID',
  diagnosticEffectiveStatus: 'INVALID',
  quarantineRunId: '42653002337',
  quarantineRunAttempt: '1',
  quarantineRunStartedAt: '2026-11-09T16:16:00.000Z',
  quarantineRunCompletedAt: '2026-11-09T16:16:20.000Z',
  ownerDisplay: 'Eason',
})

const TOP_LEVEL_KEYS = [
  'schemaVersion', 'attestationId', 'issuedByWorkflowRunId', 'targetReleaseSha', 'expiresAt', 'riskAcceptance',
]
const RISK_KEYS = [
  'approvedBy', 'approvedAt', 'approvalCommentId', 'approvalAuthorAssociation', 'riskStatement', 'releaseId',
  'noIndependentBackupVerification', 'noRestoreDrill',
]
const AUDIT_KEYS = [
  'schemaVersion', 'status', 'operation', 'operationRunId', 'operationRunAttempt', 'diagnostic', 'historicalUse',
  'historicalRuns', 'proof', 'sourcePath', 'archivePath', 'sourceMetadataBefore', 'preparedAt', 'completionRecord', 'note',
]
const COMPLETION_KEYS = [
  'schemaVersion', 'status', 'operationRunId', 'operationRunAttempt', 'proofSha256', 'targetReleaseSha', 'archivePath',
  'archiveMetadataAfter', 'originalMetadataPreserved', 'auditRecordSha256', 'completedAt',
]
const METADATA_KEYS = [
  'fileType', 'sizeBytes', 'mode', 'ownerUid', 'groupGid', 'device', 'inode', 'mtimeUtc', 'ctimeUtc', 'atimeUtc', 'sha256',
]
const HISTORICAL_RUNS = [
  { runId: '42515060937', conclusion: 'failure', result: 'RISK_ACCEPTANCE_NOT_ENABLED; deployment skipped' },
  { runId: '42516766789', conclusion: 'success', result: 'schemaVersion=3 risk accepted; database mode=skip-db; target SHA matched' },
]
const RUN_WINDOW_TOLERANCE_MS = 60_000
const MAX_RECORD_BYTES = 64 * 1024

function fail(code) {
  throw new Error(code)
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function exactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function keyDiff(value, expected) {
  const keys = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []
  return {
    missing: expected.filter(key => !Object.prototype.hasOwnProperty.call(value ?? {}, key)).sort(),
    unexpected: keys.filter(key => !expected.includes(key)).sort(),
  }
}

function safeCode(error) {
  return /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'ARCHIVE_VERIFY_FAILED'
}

function lstatOptional(fsImpl, filePath) {
  try {
    return fsImpl.lstatSync(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function assertNoSymlinkSegments(fsImpl, targetPath, platform) {
  if (platform === 'win32') return
  const absolute = resolve(targetPath)
  const segments = absolute.split(sep).filter(Boolean)
  let current = sep
  const root = fsImpl.lstatSync(current)
  if (!root.isDirectory() || root.isSymbolicLink()) fail('PATH_ROOT_INVALID')
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment)
    const stat = fsImpl.lstatSync(current)
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PATH_SEGMENT_SYMLINK_OR_INVALID')
  }
}

function assertDirectory(fsImpl, directoryPath, expected, platform) {
  assertNoSymlinkSegments(fsImpl, directoryPath, platform)
  const stat = fsImpl.lstatSync(directoryPath)
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('DIRECTORY_NOT_REGULAR')
  if (platform !== 'win32') {
    if ((stat.mode & 0o777) !== expected.mode) fail('DIRECTORY_MODE_MISMATCH')
    if (stat.uid !== expected.ownerUid) fail('DIRECTORY_OWNER_MISMATCH')
  }
  return stat
}

function fileMetadata(stat, digest) {
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
    sha256: digest,
  }
}

function readRegularFile(fsImpl, filePath, expected, { platform = process.platform } = {}) {
  assertNoSymlinkSegments(fsImpl, filePath, platform)
  const before = fsImpl.lstatSync(filePath)
  if (!before.isFile() || before.isSymbolicLink()) fail('FILE_NOT_REGULAR')
  if (before.size < 1 || before.size > expected.maxBytes) fail('FILE_SIZE_OUT_OF_RANGE')
  if (platform !== 'win32') {
    if ((before.mode & 0o777) !== expected.mode) fail('FILE_MODE_MISMATCH')
    if (before.uid !== expected.ownerUid) fail('FILE_OWNER_MISMATCH')
  }
  const constants = fsImpl.constants
  const noFollow = constants.O_NOFOLLOW ?? 0
  const noAtime = constants.O_NOATIME ?? 0
  if (platform !== 'win32' && noFollow === 0) fail('NOFOLLOW_UNAVAILABLE')
  if (platform !== 'win32' && noAtime === 0) fail('NOATIME_UNAVAILABLE')
  const fd = fsImpl.openSync(filePath, constants.O_RDONLY | noFollow | noAtime)
  try {
    const opened = fsImpl.fstatSync(fd)
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) fail('FILE_CHANGED_DURING_OPEN')
    const bytes = fsImpl.readFileSync(fd)
    const after = fsImpl.fstatSync(fd)
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size ||
        after.mtimeMs !== opened.mtimeMs || bytes.length !== after.size) fail('FILE_CHANGED_DURING_READ')
    const pathAfter = fsImpl.lstatSync(filePath)
    if (!pathAfter.isFile() || pathAfter.isSymbolicLink() ||
        pathAfter.dev !== after.dev || pathAfter.ino !== after.ino ||
        pathAfter.size !== after.size || pathAfter.mtimeMs !== after.mtimeMs) {
      fail('FILE_PATH_CHANGED_DURING_READ')
    }
    const digest = sha256(bytes)
    const meta = fileMetadata(after, digest)
    if (platform !== 'win32' && (meta.mode !== expected.mode.toString(8).padStart(4, '0') ||
        meta.ownerUid !== expected.ownerUid)) fail('FILE_METADATA_CHANGED')
    return { bytes, stat: after, metadata: meta, sha256: digest }
  } finally {
    fsImpl.closeSync(fd)
  }
}

function parseJson(bytes, code) {
  try {
    const text = bytes.toString('utf8')
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
    return value
  } catch (error) {
    if (error?.message === code) throw error
    fail(code)
  }
}

function isWithinRunWindow(value, expected) {
  if (typeof value !== 'string') return false
  const timestamp = Date.parse(value)
  const start = Date.parse(expected.quarantineRunStartedAt) - RUN_WINDOW_TOLERANCE_MS
  const end = Date.parse(expected.quarantineRunCompletedAt) + RUN_WINDOW_TOLERANCE_MS
  return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end
}

function assertMetadataMatchesProof(sourceMetadata, archiveMetadata, proofFile, expected, platform) {
  if (!exactKeys(sourceMetadata, METADATA_KEYS) || !exactKeys(archiveMetadata, METADATA_KEYS)) {
    fail('PROOF_METADATA_SHAPE_INVALID')
  }
  const sourceChecks = {
    fileType: 'REGULAR_FILE',
    sizeBytes: expected.proofSizeBytes,
    mtimeUtc: expected.proofMtimeUtc,
    sha256: expected.proofSha256,
  }
  if (platform !== 'win32') {
    sourceChecks.mode = expected.proofMode.toString(8).padStart(4, '0')
    sourceChecks.ownerUid = expected.ownerUid
  }
  for (const [key, value] of Object.entries(sourceChecks)) {
    if (sourceMetadata[key] !== value) fail('AUDIT_SOURCE_METADATA_MISMATCH')
  }
  // atime is deliberately excluded: the earlier read-only diagnostic used a
  // normal read and may have advanced it. The quarantine claim concerns the
  // bytes, owner, permissions, inode and mtime, all of which remain checked.
  const linkageKeys = ['fileType', 'sizeBytes', 'mode', 'ownerUid', 'groupGid', 'device', 'inode', 'mtimeUtc', 'sha256']
  for (const key of linkageKeys) {
    if (sourceMetadata[key] !== archiveMetadata[key]) fail('PROOF_METADATA_NOT_PRESERVED')
  }
  const stableCompletionKeys = [...linkageKeys, 'ctimeUtc']
  for (const key of stableCompletionKeys) {
    if (archiveMetadata[key] !== proofFile.metadata[key]) fail('COMPLETION_ARCHIVE_METADATA_MISMATCH')
  }
}

function validateProof(proofFile, expected) {
  if (proofFile.sha256 !== expected.proofSha256) fail('PROOF_SHA256_MISMATCH')
  if (proofFile.bytes.length !== expected.proofSizeBytes) fail('PROOF_SIZE_MISMATCH')
  if (proofFile.metadata.mtimeUtc !== expected.proofMtimeUtc) fail('PROOF_MTIME_MISMATCH')
  const proof = parseJson(proofFile.bytes, 'PROOF_JSON_INVALID')
  if (proof.schemaVersion !== 3) fail('PROOF_SCHEMA_MISMATCH')
  if (proof.targetReleaseSha !== expected.targetSha) fail('PROOF_TARGET_SHA_MISMATCH')
  if (proof.expiresAt !== expected.proofExpiresAt) fail('PROOF_EXPIRY_MISMATCH')
  if (proof.riskAcceptance?.approvedBy !== expected.ownerDisplay) fail('PROOF_IDENTITY_MISMATCH')
  const topDiff = keyDiff(proof, TOP_LEVEL_KEYS)
  const riskDiff = keyDiff(proof.riskAcceptance, RISK_KEYS)
  if (!topDiff.missing.length && !topDiff.unexpected.length && !riskDiff.missing.length && !riskDiff.unexpected.length) {
    fail('PROOF_IS_CURRENT_SCHEMA_SHAPE')
  }
  return { proof, formatDiff: {
    topLevelMissingKeys: topDiff.missing,
    topLevelUnexpectedKeys: topDiff.unexpected,
    riskAcceptanceMissingKeys: riskDiff.missing,
    riskAcceptanceUnexpectedKeys: riskDiff.unexpected,
  } }
}

function assertAuditRecord(audit, expected, proof) {
  const expectedArchivePath = join(expected.statePath, 'archived', 'historical-invalid-' + expected.proofSha256 + '.json')
  const expectedCompletionPath = expectedArchivePath + '.complete.json'
  if (audit.sourcePath !== expected.sourcePath || audit.archivePath !== expectedArchivePath) fail('AUDIT_PATH_MISMATCH')
  if (!exactKeys(audit, AUDIT_KEYS)) fail('AUDIT_RECORD_SHAPE_INVALID')
  if (audit.schemaVersion !== 1 || audit.status !== 'QUARANTINE_PREPARED' ||
      audit.operation !== 'QUARANTINE_EXACT_INVALID_SCHEMA_V3_PROOF') fail('AUDIT_OPERATION_INVALID')
  if (audit.operationRunId !== expected.quarantineRunId ||
      audit.operationRunAttempt !== expected.quarantineRunAttempt) fail('AUDIT_RUN_ID_MISMATCH')
  if (!isWithinRunWindow(audit.preparedAt, expected)) fail('AUDIT_TIMESTAMP_OUTSIDE_RUN')
  if (audit.completionRecord !== expectedCompletionPath) fail('AUDIT_PATH_MISMATCH')
  if (!exactKeys(audit.diagnostic, ['runId', 'classification', 'formatReason', 'effectiveStatus']) ||
      audit.diagnostic.runId !== expected.diagnosticRunId ||
      audit.diagnostic.classification !== 'SCHEMA_V3_INVALID' ||
      audit.diagnostic.formatReason !== 'V3_FIELDS_INVALID' ||
      audit.diagnostic.effectiveStatus !== 'INVALID') fail('AUDIT_DIAGNOSTIC_LINK_MISMATCH')
  if (audit.historicalUse !== 'CONFIRMED_BY_DEPLOY_WORKFLOW_LOG' ||
      !isDeepStrictEqual(audit.historicalRuns, HISTORICAL_RUNS)) fail('AUDIT_HISTORY_LINK_MISMATCH')
  const proofRecord = audit.proof
  if (!exactKeys(proofRecord, ['sha256', 'targetReleaseSha', 'schemaVersion', 'expiresAt', 'currentGateValidationReason', 'formatDiff']) ||
      proofRecord.sha256 !== expected.proofSha256 || proofRecord.targetReleaseSha !== expected.targetSha ||
      proofRecord.schemaVersion !== 3 || proofRecord.expiresAt !== expected.proofExpiresAt ||
      typeof proofRecord.currentGateValidationReason !== 'string' ||
      !/^[A-Z0-9_]+$/.test(proofRecord.currentGateValidationReason) ||
      !isDeepStrictEqual(proofRecord.formatDiff, proof.formatDiff)) fail('AUDIT_PROOF_LINK_MISMATCH')
  if (!exactKeys(audit.sourceMetadataBefore, METADATA_KEYS) ||
      audit.sourceMetadataBefore.sha256 !== expected.proofSha256) fail('AUDIT_SOURCE_METADATA_INVALID')
  const expectedNote = 'The proof was used by historical deployment run 42516766789. Empty current state ledgers are not evidence that it was never used.'
  if (audit.note !== expectedNote) fail('AUDIT_NOTE_MISMATCH')
}

function assertCompletionRecord(completion, auditFile, proofFile, expected) {
  const expectedArchivePath = join(expected.statePath, 'archived', 'historical-invalid-' + expected.proofSha256 + '.json')
  if (!exactKeys(completion, COMPLETION_KEYS)) fail('COMPLETION_RECORD_SHAPE_INVALID')
  if (completion.schemaVersion !== 1 || completion.status !== 'QUARANTINED' ||
      completion.operationRunId !== expected.quarantineRunId ||
      completion.operationRunAttempt !== expected.quarantineRunAttempt) fail('COMPLETION_RUN_ID_MISMATCH')
  if (completion.proofSha256 !== expected.proofSha256 || completion.targetReleaseSha !== expected.targetSha ||
      completion.archivePath !== expectedArchivePath) fail('COMPLETION_PROOF_LINK_MISMATCH')
  if (completion.auditRecordSha256 !== auditFile.sha256) fail('COMPLETION_AUDIT_SHA256_MISMATCH')
  if (!isWithinRunWindow(completion.completedAt, expected)) fail('COMPLETION_TIMESTAMP_OUTSIDE_RUN')
  if (!isDeepStrictEqual(completion.originalMetadataPreserved, {
    bytes: true, permissions: true, owner: true, mtime: true, inode: true,
  })) fail('COMPLETION_PRESERVATION_CLAIM_INVALID')
  if (!exactKeys(completion.archiveMetadataAfter, METADATA_KEYS)) fail('COMPLETION_ARCHIVE_METADATA_SHAPE_INVALID')
  for (const key of METADATA_KEYS.filter(key => key !== 'atimeUtc')) {
    if (completion.archiveMetadataAfter[key] !== proofFile.metadata[key]) {
      fail('COMPLETION_ARCHIVE_METADATA_MISMATCH')
    }
  }
}

export function verifyQuarantineArchive({
  expected = CANDIDATE,
  fsImpl = fs,
  platform = process.platform,
  lockHeld = false,
  processUid = typeof process.getuid === 'function' ? process.getuid() : undefined,
  enforceProductionRuntime = true,
} = {}) {
  if (lockHeld !== true) fail('PRODUCTION_SHARED_LOCK_NOT_HELD')
  if (enforceProductionRuntime && platform !== 'linux') fail('LINUX_READONLY_FLAGS_REQUIRED')
  if (enforceProductionRuntime && processUid !== expected.ownerUid) fail('PROCESS_OWNER_MISMATCH')
  const sourcePath = expected.sourcePath
  const statePath = expected.statePath
  const archiveDir = join(statePath, 'archived')
  const archiveProofPath = join(archiveDir, 'historical-invalid-' + expected.proofSha256 + '.json')
  const auditPath = archiveProofPath + '.quarantine.json'
  const completionPath = archiveProofPath + '.complete.json'
  if (lstatOptional(fsImpl, sourcePath)) fail('LIVE_PROOF_FILE_PRESENT')

  for (const path of [statePath, join(statePath, 'issued'), join(statePath, 'consumed'), archiveDir]) {
    assertDirectory(fsImpl, path, { mode: 0o700, ownerUid: expected.ownerUid }, platform)
  }
  const stateEntries = fsImpl.readdirSync(statePath).sort()
  if (!isDeepStrictEqual(stateEntries, ['archived', 'consumed', 'issued'])) fail('STATE_DIRECTORY_LAYOUT_INVALID')
  const issuedEntries = fsImpl.readdirSync(join(statePath, 'issued'))
  const consumedEntries = fsImpl.readdirSync(join(statePath, 'consumed'))
  if (issuedEntries.length !== 0 || consumedEntries.length !== 0) fail('ISSUANCE_OR_CONSUMPTION_RECORD_PRESENT')
  const expectedArchiveEntries = [basename(archiveProofPath), basename(auditPath), basename(completionPath)].sort()
  const archiveEntries = fsImpl.readdirSync(archiveDir).sort()
  if (!isDeepStrictEqual(archiveEntries, expectedArchiveEntries)) fail('ARCHIVE_DIRECTORY_ENTRIES_MISMATCH')

  const fileExpected = { mode: 0o600, ownerUid: expected.ownerUid, maxBytes: MAX_RECORD_BYTES }
  const proofFile = readRegularFile(fsImpl, archiveProofPath, { ...fileExpected, maxBytes: expected.proofSizeBytes }, { platform })
  const auditFile = readRegularFile(fsImpl, auditPath, fileExpected, { platform })
  const completionFile = readRegularFile(fsImpl, completionPath, fileExpected, { platform })
  for (const file of [auditFile, completionFile]) {
    const time = file.stat.mtimeMs
    const start = Date.parse(expected.quarantineRunStartedAt) - RUN_WINDOW_TOLERANCE_MS
    const end = Date.parse(expected.quarantineRunCompletedAt) + RUN_WINDOW_TOLERANCE_MS
    if (time < start || time > end) fail('RECORD_FILE_MTIME_OUTSIDE_RUN')
  }

  const proof = validateProof(proofFile, expected)
  const audit = parseJson(auditFile.bytes, 'AUDIT_JSON_INVALID')
  const completion = parseJson(completionFile.bytes, 'COMPLETION_JSON_INVALID')
  assertAuditRecord(audit, expected, proof)
  assertMetadataMatchesProof(audit.sourceMetadataBefore, completion.archiveMetadataAfter, proofFile, expected, platform)
  if (audit.preparedAt !== completion.completedAt) fail('AUDIT_COMPLETION_TIME_MISMATCH')
  assertCompletionRecord(completion, auditFile, proofFile, expected)

  return Object.freeze({
    ARCHIVE_INTEGRITY: 'PASS',
    QUARANTINE_RUN_ID_MATCH: 'YES',
    TARGET_SHA_MATCH: 'YES',
    ISSUED_RECORDS: 'NONE',
    CONSUMED_RECORDS: 'NONE',
    STATE_DIRECTORY_STATUS: 'EXPECTED_LAYOUT',
    ARCHIVE_RECORD_STATUS: 'EXACT_THREE_LINKED_FILES',
    SAFE_TO_ISSUE_NEW_ATTESTATION: 'YES_AFTER_FRESH_SHA_BOUND_OWNER_APPROVAL',
    proofFile: proofFile.metadata,
    auditFile: auditFile.metadata,
    completionFile: completionFile.metadata,
    auditRecordStatus: 'VALID',
  })
}

function outputSafeReport(report) {
  console.log('ARCHIVE_INTEGRITY=' + report.ARCHIVE_INTEGRITY)
  console.log('QUARANTINE_RUN_ID_MATCH=' + report.QUARANTINE_RUN_ID_MATCH)
  console.log('TARGET_SHA_MATCH=' + report.TARGET_SHA_MATCH)
  console.log('ARCHIVE_TARGET_SHA=' + CANDIDATE.targetSha)
  console.log('ARCHIVE_PROOF_SHA256=' + report.proofFile.sha256)
  console.log('QUARANTINE_RUN_ID=' + CANDIDATE.quarantineRunId)
  console.log('STATE_DIRECTORY_STATUS=' + report.STATE_DIRECTORY_STATUS)
  console.log('ARCHIVE_RECORD_STATUS=' + report.ARCHIVE_RECORD_STATUS)
  console.log('ISSUANCE_RECORD_STATUS=' + report.ISSUED_RECORDS)
  console.log('CONSUMPTION_RECORD_STATUS=' + report.CONSUMED_RECORDS)
  console.log('ISSUED_RECORDS=' + report.ISSUED_RECORDS)
  console.log('CONSUMED_RECORDS=' + report.CONSUMED_RECORDS)
  console.log('AUDIT_RECORD_STATUS=' + report.auditRecordStatus)
  console.log('AUDIT_RECORD_SHA256=' + report.auditFile.sha256)
  console.log('COMPLETION_RECORD_SHA256=' + report.completionFile.sha256)
  console.log('SAFE_TO_ISSUE_NEW_ATTESTATION=' + report.SAFE_TO_ISSUE_NEW_ATTESTATION)
  for (const [label, meta] of [
    ['ARCHIVE_PROOF', report.proofFile],
    ['ARCHIVE_AUDIT', report.auditFile],
    ['ARCHIVE_COMPLETION', report.completionFile],
  ]) {
    console.log(label + '_TYPE=' + meta.fileType)
    console.log(label + '_MODE=' + meta.mode)
    console.log(label + '_OWNER_UID=' + meta.ownerUid)
    console.log(label + '_SIZE_BYTES=' + meta.sizeBytes)
    console.log(label + '_MTIME_UTC=' + meta.mtimeUtc)
    console.log(label + '_SHA256=' + meta.sha256)
  }
  console.log('PRODUCTION_FILES_MUTATED=NO')
}

if (process.argv[1] === '-' && process.env.QUARANTINE_ARCHIVE_VERIFY_LOCK_HELD === 'YES') {
  try {
    outputSafeReport(verifyQuarantineArchive({ lockHeld: true }))
  } catch (error) {
    console.error('ARCHIVE_INTEGRITY=FAIL')
    console.error('ARCHIVE_VERIFY_ERROR=' + safeCode(error))
    console.error('PRODUCTION_FILES_MUTATED=NO')
    process.exitCode = 1
  }
}
