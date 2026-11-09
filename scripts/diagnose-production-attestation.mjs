#!/usr/bin/env node

/**
 * Read-only, fixed-path inspection of the production backup attestation.
 *
 * This module intentionally has no write-capable filesystem imports and no
 * command-line/environment path overrides. The exported path-injected helper
 * exists only for isolated unit tests; the production stdin entry point always
 * uses the constants below.
 */
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

export const ATTESTATION_PATH = '/home/apps/easonfansclub/shared/.backup-verification.json'
export const STATE_PATH = `${ATTESTATION_PATH}.state`

const MAX_FILE_BYTES = 256 * 1024
const MAX_DIRECTORY_ENTRIES = 2048
const MAX_ATTESTATION_TTL_MS = 24 * 60 * 60 * 1000
const MAX_APPROVAL_AGE_MS = 8 * 60 * 60 * 1000
const APPROVER = 'andkdiids'
const APPROVER_ASSOCIATION = 'OWNER'
const SHA40 = /^[0-9a-f]{40}$/
const NUMERIC_ID = /^[1-9][0-9]{0,19}$/
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_NAME = /^[A-Za-z0-9._@-]{1,64}$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BACKUP_TYPES = ['AUTOMATED_SNAPSHOT', 'MANUAL_SNAPSHOT', 'PITR_SNAPSHOT']

const V3_KEYS = [
  'schemaVersion', 'attestationId', 'issuedByWorkflowRunId', 'targetReleaseSha', 'expiresAt', 'riskAcceptance',
]
const V3_RISK_KEYS = [
  'approvedBy', 'approvedAt', 'approvalCommentId', 'approvalAuthorAssociation', 'riskStatement', 'releaseId',
  'noIndependentBackupVerification', 'noRestoreDrill',
]
const V3_FORBIDDEN_KEYS = [
  'backupId', 'backupType', 'backupCompletedAt', 'pitrAvailable', 'pitrRetentionDays', 'verifiedBy',
  'restoreDrillVerified', 'restoreDrillAt', 'restoreDrillId', 'restoreDrillReport', 'restoreDrillEvidence',
  'restoreDrillResult',
]
const ISSUANCE_KEYS = [
  'schemaVersion', 'targetReleaseSha', 'approvalCommentId', 'approvedBy', 'approvalAuthorAssociation',
  'approvedAt', 'attestationId', 'issuedByWorkflowRunId', 'issuedAt', 'proofSha256',
]
const CONSUMPTION_KEYS = [
  'schemaVersion', 'targetReleaseSha', 'runId', 'runAttempt', 'attestationId', 'approvalCommentId',
  'approvedBy', 'approvedAt', 'proofSha256', 'consumedAt',
]
const ARCHIVE_KEYS = [
  'schemaVersion', 'reason', 'archivedTargetReleaseSha', 'replacementTargetReleaseSha',
  'archivedAttestationId', 'archivedApprovalCommentId', 'archivedProofSha256', 'consumedRunId',
  'consumedRunAttempt', 'replacementApprovalCommentId', 'replacementIssuanceRunId', 'archivedAt',
]

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function exactKeys(value, expected) {
  if (!isObject(value)) return false
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function validTime(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  return Number.isFinite(Date.parse(value))
}

function normalizedTime(value) {
  if (!validTime(value)) return 'UNKNOWN'
  return new Date(Date.parse(value)).toISOString()
}

function ownerUid(stats) {
  return Number.isInteger(stats.uid) ? String(stats.uid) : 'UNKNOWN'
}

function modeText(stats) {
  return `0${(stats.mode & 0o7777).toString(8).padStart(3, '0')}`
}

function metadata(stats) {
  return {
    type: stats.isFile() ? 'REGULAR_FILE' : stats.isDirectory() ? 'DIRECTORY' : 'OTHER',
    size: String(stats.size),
    mode: modeText(stats),
    ownerUid: ownerUid(stats),
    ownerMatchesProcess: typeof process.getuid === 'function'
      ? (stats.uid === process.getuid() ? 'YES' : 'NO')
      : 'UNKNOWN',
    mtime: Number.isFinite(stats.mtimeMs) ? new Date(stats.mtimeMs).toISOString() : 'UNKNOWN',
  }
}

function lstatWithoutSymlinks(absolutePath) {
  const resolvedPath = path.resolve(absolutePath)
  const parsed = path.parse(resolvedPath)
  const pieces = path.relative(parsed.root, resolvedPath).split(path.sep).filter(Boolean)
  let cursor = parsed.root
  let finalStats = null

  for (let index = 0; index < pieces.length; index += 1) {
    cursor = path.join(cursor, pieces[index])
    let stats
    try {
      stats = lstatSync(cursor)
    } catch (error) {
      if (error?.code === 'ENOENT') return { status: 'MISSING', stats: null }
      return { status: 'UNAVAILABLE', stats: null }
    }
    if (stats.isSymbolicLink()) return { status: 'UNSAFE_SYMLINK', stats }
    if (index < pieces.length - 1 && !stats.isDirectory()) return { status: 'NOT_DIRECTORY', stats }
    finalStats = stats
  }

  return { status: 'PRESENT', stats: finalStats }
}

function readNoFollow(absolutePath, { testOnlyAllowNoFollowFallback = false } = {}) {
  const checked = lstatWithoutSymlinks(absolutePath)
  if (checked.status !== 'PRESENT') return { ...checked, bytes: null, hash: null, text: null }
  if (!checked.stats.isFile()) return { status: 'NOT_REGULAR_FILE', stats: checked.stats, bytes: null, hash: null, text: null }
  if (checked.stats.size > MAX_FILE_BYTES) return { status: 'TOO_LARGE', stats: checked.stats, bytes: null, hash: null, text: null }
  if (typeof constants.O_NOFOLLOW !== 'number' && !testOnlyAllowNoFollowFallback) {
    return { status: 'NOFOLLOW_UNAVAILABLE', stats: checked.stats, bytes: null, hash: null, text: null }
  }

  let descriptor
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const opened = fstatSync(descriptor)
    if (!opened.isFile() || opened.dev !== checked.stats.dev || opened.ino !== checked.stats.ino) {
      return { status: 'FILE_CHANGED_DURING_OPEN', stats: checked.stats, bytes: null, hash: null, text: null }
    }
    const before = fstatSync(descriptor)
    const bytes = readFileSync(descriptor)
    const after = fstatSync(descriptor)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
      return { status: 'FILE_CHANGED_DURING_READ', stats: after, bytes: null, hash: null, text: null }
    }
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      return { status: 'INVALID_UTF8', stats: after, bytes, hash: sha256(bytes), text: null }
    }
    return { status: 'OK', stats: after, bytes, hash: sha256(bytes), text }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'MISSING', stats: null, bytes: null, hash: null, text: null }
    if (error?.code === 'ELOOP') return { status: 'UNSAFE_SYMLINK', stats: checked.stats, bytes: null, hash: null, text: null }
    return { status: 'READ_FAILED', stats: checked.stats, bytes: null, hash: null, text: null }
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch {}
    }
  }
}

function parseJson(text) {
  try {
    const value = JSON.parse(text)
    return isObject(value) ? { status: 'OK', value } : { status: 'UNKNOWN_FORMAT', value: null }
  } catch {
    return { status: 'INVALID_JSON', value: null }
  }
}

function validLegacyCommon(data) {
  return SAFE_ID.test(String(data.backupId ?? '')) &&
    BACKUP_TYPES.includes(data.backupType) &&
    SAFE_NAME.test(String(data.verifiedBy ?? '')) &&
    SHA40.test(String(data.targetReleaseSha ?? '')) &&
    data.pitrAvailable === true &&
    Number.isSafeInteger(data.pitrRetentionDays) && data.pitrRetentionDays >= 1 &&
    validTime(data.backupCompletedAt) && validTime(data.expiresAt)
}

function validateLegacyV1(data) {
  return validLegacyCommon(data) &&
    data.restoreDrillVerified === true && validTime(data.restoreDrillAt) &&
    Date.parse(data.restoreDrillAt) >= Date.parse(data.backupCompletedAt)
}

function validateLegacyV2(data) {
  const waiver = data.restoreDrillWaiver
  return validLegacyCommon(data) && data.backupType === 'AUTOMATED_SNAPSHOT' &&
    !['restoreDrillVerified', 'restoreDrillAt', 'restoreDrillId', 'restoreDrillReport', 'restoreDrillEvidence', 'restoreDrillResult']
      .some(key => Object.prototype.hasOwnProperty.call(data, key)) &&
    isObject(waiver) &&
    typeof waiver.approvedBy === 'string' && waiver.approvedBy.length > 0 &&
    validTime(waiver.approvedAt) && typeof waiver.riskStatement === 'string' &&
    waiver.riskStatement.trim().length >= 8 && waiver.riskStatement.length <= 1024 &&
    waiver.releaseId === data.targetReleaseSha
}

function validateV3(data, now) {
  if (!exactKeys(data, V3_KEYS) || !exactKeys(data.riskAcceptance, V3_RISK_KEYS)) return 'V3_FIELDS_INVALID'
  if (V3_FORBIDDEN_KEYS.some(key => Object.prototype.hasOwnProperty.call(data, key))) return 'V3_BACKUP_FIELDS_FORBIDDEN'
  const risk = data.riskAcceptance
  if (!SHA40.test(String(data.targetReleaseSha ?? '')) || risk.releaseId !== data.targetReleaseSha) return 'V3_SHA_INVALID'
  if (!UUID_V4.test(String(data.attestationId ?? '')) || !NUMERIC_ID.test(String(data.issuedByWorkflowRunId ?? ''))) return 'V3_ID_INVALID'
  if (risk.approvedBy !== APPROVER || risk.approvalAuthorAssociation !== APPROVER_ASSOCIATION ||
      !NUMERIC_ID.test(String(risk.approvalCommentId ?? ''))) return 'V3_APPROVAL_IDENTITY_INVALID'
  if (typeof risk.riskStatement !== 'string' || risk.riskStatement.trim().length < 8 || risk.riskStatement.length > 1024 ||
      risk.noIndependentBackupVerification !== true || risk.noRestoreDrill !== true) return 'V3_RISK_FIELDS_INVALID'
  if (!validTime(data.expiresAt) || !validTime(risk.approvedAt)) return 'V3_TIME_INVALID'
  const expiresAt = Date.parse(data.expiresAt)
  const approvedAt = Date.parse(risk.approvedAt)
  if (expiresAt <= now) return 'V3_EXPIRED'
  if (expiresAt - now > MAX_ATTESTATION_TTL_MS) return 'V3_TTL_TOO_LONG'
  if (approvedAt > now || now - approvedAt > MAX_APPROVAL_AGE_MS || approvedAt >= expiresAt) return 'V3_APPROVAL_TIME_INVALID'
  return 'VALID'
}

function classify(data, parseStatus, now) {
  if (parseStatus !== 'OK') return { type: parseStatus, schemaVersion: 'UNKNOWN', formatValid: 'NO', reason: parseStatus }
  if (data.schemaVersion === 1) {
    const valid = validateLegacyV1(data)
    return { type: 'LEGACY_SCHEMA_V1', schemaVersion: '1', formatValid: valid ? 'YES' : 'NO', reason: valid ? 'LEGACY_V1_SHAPE_VALID' : 'LEGACY_V1_SHAPE_INVALID' }
  }
  if (data.schemaVersion === 2) {
    const valid = validateLegacyV2(data)
    return { type: 'LEGACY_SCHEMA_V2', schemaVersion: '2', formatValid: valid ? 'YES' : 'NO', reason: valid ? 'LEGACY_V2_SHAPE_VALID' : 'LEGACY_V2_SHAPE_INVALID' }
  }
  if (data.schemaVersion === 3) {
    const reason = validateV3(data, now)
    return { type: reason === 'VALID' ? 'SCHEMA_V3_VALID' : 'SCHEMA_V3_INVALID', schemaVersion: '3', formatValid: reason === 'VALID' ? 'YES' : 'NO', reason }
  }
  return { type: 'UNKNOWN_FORMAT', schemaVersion: Number.isSafeInteger(data.schemaVersion) ? String(data.schemaVersion) : 'UNKNOWN', formatValid: 'NO', reason: 'SCHEMA_VERSION_UNSUPPORTED' }
}

function inspectDirectory(directoryPath) {
  const checked = lstatWithoutSymlinks(directoryPath)
  if (checked.status !== 'PRESENT') return { status: checked.status, stats: checked.stats, count: 'UNKNOWN', regular: 'UNKNOWN', symlinks: 'UNKNOWN', other: 'UNKNOWN' }
  if (!checked.stats.isDirectory()) return { status: 'NOT_DIRECTORY', stats: checked.stats, count: 'UNKNOWN', regular: 'UNKNOWN', symlinks: 'UNKNOWN', other: 'UNKNOWN' }
  let names
  try {
    names = readdirSync(directoryPath)
  } catch {
    return { status: 'UNREADABLE', stats: checked.stats, count: 'UNKNOWN', regular: 'UNKNOWN', symlinks: 'UNKNOWN', other: 'UNKNOWN' }
  }
  if (names.length > MAX_DIRECTORY_ENTRIES) {
    return { status: 'PRESENT_SCAN_LIMIT', stats: checked.stats, count: String(names.length), regular: 'UNKNOWN', symlinks: 'UNKNOWN', other: 'UNKNOWN' }
  }
  let regular = 0
  let symlinks = 0
  let other = 0
  for (const name of names) {
    const entry = lstatWithoutSymlinks(path.join(directoryPath, name))
    if (entry.status === 'UNSAFE_SYMLINK' || entry.stats?.isSymbolicLink()) symlinks += 1
    else if (entry.status === 'PRESENT' && entry.stats.isFile()) regular += 1
    else other += 1
  }
  return { status: 'PRESENT', stats: checked.stats, count: String(names.length), regular: String(regular), symlinks: String(symlinks), other: String(other) }
}

function recordResult(recordPath, validate, testOnlyAllowNoFollowFallback) {
  const file = readNoFollow(recordPath, { testOnlyAllowNoFollowFallback })
  if (file.status !== 'OK') return { status: file.status === 'MISSING' ? 'MISSING' : file.status, hash: file.hash ?? 'UNKNOWN', metadata: file.stats ? metadata(file.stats) : null }
  const parsed = parseJson(file.text)
  if (parsed.status !== 'OK') return { status: 'INVALID_JSON', hash: file.hash, metadata: metadata(file.stats) }
  return { status: validate(parsed.value, file.text, file.hash) ? 'VALID' : 'INVALID', hash: file.hash, metadata: metadata(file.stats) }
}

function sameString(actual, expected) {
  return typeof actual === 'string' && actual === expected
}

function inspectV3Records(data, proofHash, statePath, testOnlyAllowNoFollowFallback) {
  const risk = data.riskAcceptance
  if (!NUMERIC_ID.test(String(risk?.approvalCommentId ?? '')) || !UUID_V4.test(String(data.attestationId ?? ''))) {
    return {
      issuance: { status: 'UNAVAILABLE_INVALID_PROOF_LINK_KEYS', hash: 'UNKNOWN', metadata: null },
      consumption: { status: 'UNAVAILABLE_INVALID_PROOF_LINK_KEYS', hash: 'UNKNOWN', metadata: null },
      archiveProof: { status: 'UNAVAILABLE_INVALID_PROOF_LINK_KEYS', hash: 'UNKNOWN', metadata: null },
      archive: { status: 'UNAVAILABLE_INVALID_PROOF_LINK_KEYS', hash: 'UNKNOWN', metadata: null },
    }
  }
  const issuedPath = path.join(statePath, 'issued', `${risk.approvalCommentId}.json`)
  const consumedPath = path.join(statePath, 'consumed', `${risk.approvalCommentId}.json`)
  const archiveProofPath = path.join(statePath, 'archived', `${data.attestationId}.json`)
  const archiveRecordPath = path.join(statePath, 'archived', `${data.attestationId}.archive.json`)

  const issuance = recordResult(issuedPath, record => exactKeys(record, ISSUANCE_KEYS) &&
    record.schemaVersion === 1 && record.targetReleaseSha === data.targetReleaseSha &&
    sameString(record.approvalCommentId, risk.approvalCommentId) && sameString(record.approvedBy, risk.approvedBy) &&
    sameString(record.approvalAuthorAssociation, risk.approvalAuthorAssociation) && sameString(record.approvedAt, risk.approvedAt) &&
    sameString(record.attestationId, data.attestationId) && sameString(record.issuedByWorkflowRunId, data.issuedByWorkflowRunId) &&
    validTime(record.issuedAt) && record.proofSha256 === proofHash, testOnlyAllowNoFollowFallback)

  const consumption = recordResult(consumedPath, record => exactKeys(record, CONSUMPTION_KEYS) &&
    record.schemaVersion === 1 && record.targetReleaseSha === data.targetReleaseSha &&
    sameString(record.approvalCommentId, risk.approvalCommentId) && sameString(record.approvedBy, risk.approvedBy) &&
    sameString(record.approvedAt, risk.approvedAt) && sameString(record.attestationId, data.attestationId) &&
    record.proofSha256 === proofHash && NUMERIC_ID.test(String(record.runId ?? '')) &&
    /^[1-9][0-9]{0,5}$/.test(String(record.runAttempt ?? '')) && validTime(record.consumedAt), testOnlyAllowNoFollowFallback)

  const archiveProof = recordResult(archiveProofPath, (_record, text, digest) => digest === proofHash && text.length > 0, testOnlyAllowNoFollowFallback)
  const archive = recordResult(archiveRecordPath, record => exactKeys(record, ARCHIVE_KEYS) &&
    record.schemaVersion === 1 && ['REAPPROVED_AFTER_CONSUMPTION', 'EXPIRED_UNCONSUMED'].includes(record.reason) &&
    record.archivedTargetReleaseSha === data.targetReleaseSha && record.archivedAttestationId === data.attestationId &&
    record.archivedApprovalCommentId === risk.approvalCommentId && record.archivedProofSha256 === proofHash &&
    SHA40.test(String(record.replacementTargetReleaseSha ?? '')) && NUMERIC_ID.test(String(record.replacementApprovalCommentId ?? '')) &&
    NUMERIC_ID.test(String(record.replacementIssuanceRunId ?? '')) && validTime(record.archivedAt), testOnlyAllowNoFollowFallback)

  if (archiveProof.status === 'MISSING' && archive.status === 'MISSING') archive.status = 'ABSENT'
  else if (archiveProof.status !== 'VALID' || archive.status !== 'VALID') archive.status = 'INCOMPLETE_OR_INVALID'
  return { issuance, consumption, archiveProof, archive }
}

function outputRecordFields(report, prefix, record) {
  report[`${prefix}_RECORD_STATUS`] = record.status
  report[`${prefix}_RECORD_SHA256`] = record.hash
  if (record.metadata) {
    report[`${prefix}_RECORD_FILE_TYPE`] = record.metadata.type
    report[`${prefix}_RECORD_SIZE_BYTES`] = record.metadata.size
    report[`${prefix}_RECORD_MODE`] = record.metadata.mode
    report[`${prefix}_RECORD_OWNER_UID`] = record.metadata.ownerUid
    report[`${prefix}_RECORD_OWNER_MATCHES_PROCESS`] = record.metadata.ownerMatchesProcess
    report[`${prefix}_RECORD_MTIME_UTC`] = record.metadata.mtime
  }
}

/**
 * Test seam for temporary fixtures. Production CLI never accepts caller paths
 * and invokes this helper only with fixed absolute paths.
 */
export function diagnoseAttestationAt({ attestationPath, statePath, now = Date.now(), testOnlyAllowNoFollowFallback = false }) {
  if (typeof attestationPath !== 'string' || !path.isAbsolute(attestationPath) ||
      typeof statePath !== 'string' || !path.isAbsolute(statePath) || !Number.isFinite(now)) {
    throw new Error('DIAGNOSTIC_INPUT_INVALID')
  }
  const proof = readNoFollow(attestationPath, { testOnlyAllowNoFollowFallback })
  const report = {
    DIAGNOSTIC_STATUS: 'COMPLETE',
    READONLY_MODE: 'YES',
    ATTESTATION_FILE_TYPE: proof.status === 'OK' || proof.status === 'INVALID_UTF8'
      ? 'REGULAR_FILE'
      : proof.status === 'MISSING' ? 'MISSING' : proof.status,
    ATTESTATION_READ_STATUS: proof.status,
    ATTESTATION_SIZE_BYTES: proof.stats ? String(proof.stats.size) : 'UNKNOWN',
    ATTESTATION_MODE: proof.stats ? modeText(proof.stats) : 'UNKNOWN',
    ATTESTATION_OWNER_UID: proof.stats ? ownerUid(proof.stats) : 'UNKNOWN',
    ATTESTATION_OWNER_MATCHES_PROCESS: proof.stats
      ? (typeof process.getuid === 'function' ? (proof.stats.uid === process.getuid() ? 'YES' : 'NO') : 'UNKNOWN')
      : 'UNKNOWN',
    ATTESTATION_MTIME_UTC: proof.stats ? new Date(proof.stats.mtimeMs).toISOString() : 'UNKNOWN',
    ATTESTATION_FILE_SHA256: proof.hash ?? 'UNKNOWN',
    ATTESTATION_SCHEMA_VERSION: 'UNKNOWN',
    ATTESTATION_TARGET_SHA: 'UNKNOWN',
    ATTESTATION_EXPIRES_AT: 'UNKNOWN',
    RISK_ACCEPTANCE_FIELD_PRESENT: 'UNKNOWN',
    ATTESTATION_CLASSIFICATION: 'UNKNOWN_FORMAT',
    ATTESTATION_FORMAT_VALID: 'NO',
    ATTESTATION_FORMAT_REASON: proof.status,
  }

  let data = null
  let classification = { type: 'UNKNOWN_FORMAT', schemaVersion: 'UNKNOWN', formatValid: 'NO', reason: proof.status }
  if (proof.status === 'MISSING') {
    classification = { type: 'MISSING_FILE', schemaVersion: 'UNKNOWN', formatValid: 'NO', reason: 'MISSING_FILE' }
  } else if (proof.status === 'OK') {
    const parsed = parseJson(proof.text)
    classification = classify(parsed.value, parsed.status, now)
    if (parsed.status === 'OK') {
      data = parsed.value
      report.ATTESTATION_TARGET_SHA = SHA40.test(String(data.targetReleaseSha ?? '')) ? data.targetReleaseSha : 'UNKNOWN'
      report.ATTESTATION_EXPIRES_AT = normalizedTime(data.expiresAt)
      report.RISK_ACCEPTANCE_FIELD_PRESENT = Object.prototype.hasOwnProperty.call(data, 'riskAcceptance') ? 'YES' : 'NO'
    }
  } else if (proof.status === 'INVALID_UTF8') {
    classification = { type: 'INVALID_JSON', schemaVersion: 'UNKNOWN', formatValid: 'NO', reason: 'INVALID_UTF8' }
  }
  report.ATTESTATION_SCHEMA_VERSION = classification.schemaVersion
  report.ATTESTATION_CLASSIFICATION = classification.type
  report.ATTESTATION_FORMAT_VALID = classification.formatValid
  report.ATTESTATION_FORMAT_REASON = classification.reason

  const state = inspectDirectory(statePath)
  report.STATE_DIRECTORY_STATUS = state.status
  report.STATE_DIRECTORY_ENTRY_COUNT = state.count
  report.STATE_DIRECTORY_MODE = state.stats ? modeText(state.stats) : 'UNKNOWN'
  report.STATE_DIRECTORY_OWNER_UID = state.stats ? ownerUid(state.stats) : 'UNKNOWN'
  report.STATE_DIRECTORY_OWNER_MATCHES_PROCESS = state.stats
    ? (typeof process.getuid === 'function' ? (state.stats.uid === process.getuid() ? 'YES' : 'NO') : 'UNKNOWN')
    : 'UNKNOWN'

  const subdirectories = {}
  for (const name of ['issued', 'consumed', 'archived']) {
    const directory = inspectDirectory(path.join(statePath, name))
    subdirectories[name] = directory
    const prefix = name.toUpperCase()
    report[`${prefix}_DIRECTORY_STATUS`] = directory.status
    report[`${prefix}_DIRECTORY_ENTRY_COUNT`] = directory.count
    report[`${prefix}_DIRECTORY_REGULAR_FILES`] = directory.regular
    report[`${prefix}_DIRECTORY_SYMLINKS`] = directory.symlinks
    report[`${prefix}_DIRECTORY_MODE`] = directory.stats ? modeText(directory.stats) : 'UNKNOWN'
    report[`${prefix}_DIRECTORY_OWNER_UID`] = directory.stats ? ownerUid(directory.stats) : 'UNKNOWN'
    report[`${prefix}_DIRECTORY_OWNER_MATCHES_PROCESS`] = directory.stats
      ? (typeof process.getuid === 'function' ? (directory.stats.uid === process.getuid() ? 'YES' : 'NO') : 'UNKNOWN')
      : 'UNKNOWN'
  }

  let records = null
  if (classification.type === 'SCHEMA_V3_VALID' || classification.type === 'SCHEMA_V3_INVALID') {
    records = inspectV3Records(data, proof.hash ?? 'UNKNOWN', statePath, testOnlyAllowNoFollowFallback)
  } else {
    records = {
      issuance: { status: 'UNLINKED_NO_V3_KEYS', hash: 'UNKNOWN', metadata: null },
      consumption: { status: 'UNLINKED_NO_V3_KEYS', hash: 'UNKNOWN', metadata: null },
      archiveProof: { status: 'UNLINKED_NO_V3_KEYS', hash: 'UNKNOWN', metadata: null },
      archive: { status: 'UNLINKED_NO_V3_KEYS', hash: 'UNKNOWN', metadata: null },
    }
  }
  outputRecordFields(report, 'ISSUANCE', records.issuance)
  outputRecordFields(report, 'CONSUMPTION', records.consumption)
  outputRecordFields(report, 'ARCHIVE_PROOF', records.archiveProof)
  outputRecordFields(report, 'ARCHIVE', records.archive)

  if (classification.type === 'MISSING_FILE') report.PROOF_EFFECTIVE_STATUS = 'NO_PROOF_FILE'
  else if (classification.type === 'LEGACY_SCHEMA_V1' || classification.type === 'LEGACY_SCHEMA_V2') {
    report.PROOF_EFFECTIVE_STATUS = 'LEGACY_REQUIRES_PRODUCTION_GATE_VALIDATION'
  } else if (classification.type === 'SCHEMA_V3_INVALID') report.PROOF_EFFECTIVE_STATUS = 'INVALID'
  else if (classification.type === 'SCHEMA_V3_VALID') {
    if (records.issuance.status !== 'VALID') report.PROOF_EFFECTIVE_STATUS = 'UNVERIFIED_ISSUANCE_RECORD'
    else if (records.consumption.status === 'VALID') report.PROOF_EFFECTIVE_STATUS = 'CONSUMED'
    else if (records.consumption.status !== 'MISSING') report.PROOF_EFFECTIVE_STATUS = 'INVALID_CONSUMPTION_RECORD'
    else if (records.archive.status === 'VALID') report.PROOF_EFFECTIVE_STATUS = 'LIVE_AND_ARCHIVED_CONFLICT'
    else report.PROOF_EFFECTIVE_STATUS = 'ACTIVE_UNCONSUMED'
  } else report.PROOF_EFFECTIVE_STATUS = 'UNKNOWN'

  report.PRODUCTION_FILES_MUTATED = 'NO'
  return report
}

function main() {
  try {
    const report = diagnoseAttestationAt({ attestationPath: ATTESTATION_PATH, statePath: STATE_PATH })
    for (const [key, value] of Object.entries(report)) {
      if (/^[A-Z0-9_]+$/.test(key) && (typeof value === 'string' || typeof value === 'number')) {
        console.log(`${key}=${value}`)
      }
    }
    if (report.DIAGNOSTIC_STATUS !== 'COMPLETE') process.exitCode = 1
  } catch {
    console.log('DIAGNOSTIC_STATUS=UNAVAILABLE')
    console.log('READONLY_MODE=YES')
    console.log('DIAGNOSTIC_ERROR=SAFE_READ_FAILED')
    console.log('PRODUCTION_FILES_MUTATED=NO')
    process.exitCode = 1
  }
}

if (process.argv[1] === '-') main()
