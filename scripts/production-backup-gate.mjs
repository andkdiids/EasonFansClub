#!/usr/bin/env node
/**
 * Production pre-deployment backup gate (strictly read-only).
 *
 * WHY: `deploy.yml` runs `prisma migrate deploy` by default and the CynosDB
 * backup/PITR state lives in the Tencent Cloud console, not on the app host.
 * A deployment must therefore be blocked automatically unless a human has
 * actually verified a recent, recoverable backup and PITR for THIS exact
 * release SHA. The absence of a `*.sql` file on the app host is NOT evidence
 * that no cloud backup exists, and it is equally NOT evidence that one is
 * recoverable; only a signed-off attestation is.
 *
 * ---------------------------------------------------------------------------
 * schemaVersion 1 (STRICT, unchanged): requires a REAL restore drill.
 *
 *   {
 *     "schemaVersion": 1,
 *     "backupId": "cynos-auto-20261106-170000",
 *     "backupType": "AUTOMATED_SNAPSHOT",
 *     "backupCompletedAt": "2026-11-06T17:00:00+08:00",
 *     "pitrAvailable": true,
 *     "pitrRetentionDays": 7,
 *     "restoreDrillVerified": true,
 *     "restoreDrillAt": "2026-11-06T17:30:00+08:00",
 *     "verifiedBy": "release-operator",
 *     "targetReleaseSha": "<40-char lowercase SHA of the release to deploy>",
 *     "expiresAt": "2026-11-07T00:00:00+08:00"
 *   }
 *
 * ---------------------------------------------------------------------------
 * schemaVersion 2 (ONE-OFF, EXPLICITLY APPROVED RESTORE-DRILL WAIVER).
 *
 * This path exists ONLY for a release whose owner has explicitly accepted, in
 * writing, that a real restore drill was NOT performed. It waives EXACTLY two
 * fields (`restoreDrillVerified` and `restoreDrillAt`) and NOTHING else: the
 * real automatic snapshot, PITR, retention, backup age, verifier, exact target
 * release SHA, short expiry, file permissions and file owner are all still
 * checked with the same strictness as schemaVersion 1.
 *
 * The workflow must ALSO pass `--waiver-mode approved` (default `none`); a
 * push-triggered deployment therefore never takes the waiver path, and the
 * first automatic deployment after a merge is safely blocked until a human
 * re-triggers with the explicit approval.
 *
 *   {
 *     "schemaVersion": 2,
 *     "backupId": "<REAL cloud automatic snapshot id; NEVER invented>",
 *     "backupType": "AUTOMATED_SNAPSHOT",
 *     "backupCompletedAt": "<REAL successful snapshot completion time>",
 *     "pitrAvailable": true,
 *     "pitrRetentionDays": 7,
 *     "verifiedBy": "<person who verified the cloud console>",
 *     "restoreDrillWaiver": {
 *       "approvedBy": "<named human approver>",
 *       "approvedAt": "<ISO timestamp of the written approval>",
 *       "riskStatement": "Automatic backup + PITR are NOT a tested restore; the database cannot be rolled back. Risk accepted for this release only.",
 *       "releaseId": "<exact 40-char deployed main SHA>"
 *     },
 *     "targetReleaseSha": "<same exact 40-char deployed main SHA>",
 *     "expiresAt": "<short expiry, <=24h from now>"
 *   }
 *
 * A schemaVersion 2 attestation MUST NOT contain `restoreDrillVerified`,
 * `restoreDrillAt` or any other restore-drill record: fabricating a drill that
 * never happened is rejected outright. The gate prints
 * `RESTORE_DRILL_VERIFIED=NO` and `RESTORE_DRILL_WAIVED=YES` on this path so
 * nobody can mistake "waived" for "verified". `backupId`, snapshot times and
 * PITR values are supplied by the human from the cloud console; this script
 * NEVER generates, guesses or back-fills any of them.
 *
 * `releaseId` and `targetReleaseSha` must both equal the exact deploy SHA, the
 * written approval must be recent (MAX_WAIVER_AGE_HOURS) and the attestation
 * expires quickly (MAX_ATTESTATION_TTL_HOURS). An expired or different-SHA
 * waiver requires a NEW written approval.
 *
 * ---------------------------------------------------------------------------
 * schemaVersion 3 (ONE-OFF, EXPLICIT RISK ACCEPTANCE — the narrowest door).
 *
 *   {
 *     "schemaVersion": 3,
 *     "attestationId": "<UUID v4 generated once by the protected signer>",
 *     "issuedByWorkflowRunId": "<GitHub signer workflow run id>",
 *     "targetReleaseSha": "<exact 40-char deployed main SHA>",
 *     "expiresAt": "<short expiry, <=24h from now>",
 *     "riskAcceptance": {
 *       "approvedBy": "<named human approver>",
 *       "approvedAt": "<ISO timestamp of the written approval>",
 *       "approvalCommentId": "<numeric GitHub PR issue-comment id>",
 *       "approvalAuthorAssociation": "OWNER",
 *       "riskStatement": "No independent CynosDB backup/PITR verification was
 *                         obtained and no restore drill was performed. The
 *                         database has no automatic down migration; failures
 *                         require forward repair. Risk accepted for this
 *                         release only.",
 *       "releaseId": "<exact 40-char deployed main SHA>",
 *       "noIndependentBackupVerification": true,
 *       "noRestoreDrill": true
 *     }
 *   }
 *
 * This path asserts NOTHING about backups/PITR/drills — it records the risk as
 * explicitly unverified. Any `backupId`/`pitrAvailable`/`restoreDrill*` field
 * inside the attestation is rejected (fabrication). The gate prints
 * `BACKUP_VERIFIED=NO`, `BACKUP_PITR_VERIFIED=NO`, `RESTORE_DRILL_VERIFIED=NO`,
 * `RESTORE_DRILL_WAIVED=YES`, `RISK_ACCEPTED=YES`. It is reachable ONLY when the
 * workflow is explicitly re-triggered with `risk_acceptance=approved`; a push
 * event never takes it. The strict v1/v2 paths are unchanged.
 *
 * ---------------------------------------------------------------------------
 * MINIMUM HUMAN PROCEDURE before any production deployment:
 *   1. In the Tencent Cloud CynosDB console, confirm automatic backup is
 *      enabled, note the retention period, and identify the most recent
 *      SUCCESSFUL snapshot for the `easonfansclub` cluster (real id + time).
 *   2. Confirm PITR is enabled and note the retention window in days.
 *   3. For schemaVersion 1: perform (or review) a real restore drill into a
 *      separate instance and record when it was verified.
 *      For schemaVersion 2: obtain a written, named, SHA-bound approval that
 *      explicitly accepts the untested-restore risk, and record who/when.
 *   4. Write the attestation with the EXACT deployed main SHA and a short
 *      expiry, then `chmod 600` it and ensure it is owned by the deploy user.
 *   5. Re-run the deployment. The gate re-reads the attestation on the host;
 *      an expired, stale, mismatched, unapproved or fabricated attestation
 *      always fails.
 *
 * The gate never reads DATABASE_URL, never prints any environment value and
 * never touches the database. `prisma migrate deploy` and the atomic switch
 * are downstream of this gate in both deploy.yml and deploy-production-git.sh.
 *
 * Usage:
 *   node scripts/production-backup-gate.mjs --cli verify \
 *     --attestation <path> --deploy-sha <40-hex> \
 *     [--waiver-mode none|approved] [--now <iso>] \
 *     [--max-backup-age-hours 24]
 *   # Also usable via stdin on the production host:
 *   # cat scripts/production-backup-gate.mjs | ssh <host> \
 *   #   node --input-type=module - --cli verify --attestation <path> --deploy-sha <sha>
 */

import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'

export const SCHEMA_VERSION = 1
export const WAIVER_SCHEMA_VERSION = 2
export const DEFAULT_MAX_BACKUP_AGE_HOURS = 24
export const MAX_ATTESTATION_TTL_HOURS = 24
/** A written drill-waiver approval must be re-issued within this window. */
export const MAX_WAIVER_AGE_HOURS = 8
export const ALLOWED_BACKUP_TYPES = ['AUTOMATED_SNAPSHOT', 'MANUAL_SNAPSHOT', 'PITR_SNAPSHOT']
/** A waiver may rest ONLY on a real cloud automatic snapshot, never a manual/fabricated one. */
export const WAIVER_ALLOWED_BACKUP_TYPES = ['AUTOMATED_SNAPSHOT']
export const WAIVER_MODE_NONE = 'none'
export const WAIVER_MODE_APPROVED = 'approved'
export const SUPPORTED_WAIVER_MODES = [WAIVER_MODE_NONE, WAIVER_MODE_APPROVED]

/**
 * schemaVersion 3 (ONE-OFF, EXPLICIT RISK ACCEPTANCE for a release whose owner
 * has accepted, in writing, that NO independent verification of the CynosDB
 * automatic backup or PITR was obtained and that a real restore drill was NOT
 * performed). This is the narrowest possible door: it does NOT assert any
 * backup/PITR/restore-drill fact (those would be fabrications), it binds to the
 * exact deployed SHA, expires quickly, and is opt-in only via an explicit
 * `workflow_dispatch` with `risk_acceptance=approved`. The strict schemaVersion
 * 1 path (and the drill-only schemaVersion 2 path) are completely unchanged.
 */
export const RISK_ACCEPTANCE_SCHEMA_VERSION = 3
export const RISK_ACCEPTANCE_MODE_NONE = 'none'
export const RISK_ACCEPTANCE_MODE_APPROVED = 'approved'
export const SUPPORTED_RISK_ACCEPTANCE_MODES = [RISK_ACCEPTANCE_MODE_NONE, RISK_ACCEPTANCE_MODE_APPROVED]
export const RISK_ACCEPTANCE_REQUIRED_FIELDS = [
  'approvedBy',
  'approvedAt',
  'approvalCommentId',
  'approvalAuthorAssociation',
  'riskStatement',
  'releaseId',
]

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_NAME = /^[A-Za-z0-9._@-]{1,64}$/
const SHA40 = /^[0-9a-f]{40}$/
const NUMERIC_ID = /^[1-9][0-9]{0,19}$/
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const RISK_ACCEPTANCE_APPROVER = 'andkdiids'
const HOUR_MS = 3_600_000
const WAIVER_REQUIRED_FIELDS = ['approvedBy', 'approvedAt', 'riskStatement', 'releaseId']
// Any restore-drill record inside a waiver attestation is a fabricated drill.
const FORBIDDEN_DRILL_KEYS = [
  'restoreDrillVerified',
  'restoreDrillAt',
  'restoreDrillId',
  'restoreDrillReport',
  'restoreDrillEvidence',
  'restoreDrillResult',
]

// schemaVersion 3 must NEVER assert a backup/PITR/restore-drill fact that was not
// independently verified. Any such key is a fabricated verification and is rejected.
const RISK_ACCEPTANCE_FORBIDDEN_KEYS = [
  'backupId',
  'backupType',
  'backupCompletedAt',
  'pitrAvailable',
  'pitrRetentionDays',
  'verifiedBy',
  'restoreDrillVerified',
  'restoreDrillAt',
  'restoreDrillId',
  'restoreDrillReport',
  'restoreDrillEvidence',
  'restoreDrillResult',
  ...FORBIDDEN_DRILL_KEYS,
]

function parseTime(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Every check that schemaVersion 1 and schemaVersion 2 share. Returning a
 * truthy value means the attestation was rejected (the value is the result).
 */
function verifyCommonFields(data, { deploySha, reject, allowedBackupTypes }) {
  if (typeof data.backupId !== 'string' || !SAFE_ID.test(data.backupId)) return reject('BACKUP_ID_INVALID')
  if (!allowedBackupTypes.includes(data.backupType)) return reject('BACKUP_TYPE_UNSUPPORTED')
  if (typeof data.verifiedBy !== 'string' || !SAFE_NAME.test(data.verifiedBy)) return reject('VERIFIED_BY_INVALID')
  if (data.targetReleaseSha !== deploySha) return reject('TARGET_RELEASE_SHA_MISMATCH')
  if (data.pitrAvailable !== true) return reject('PITR_NOT_CONFIRMED')
  if (!Number.isSafeInteger(data.pitrRetentionDays) || data.pitrRetentionDays < 1) {
    return reject('PITR_RETENTION_INVALID')
  }
  return null
}

/** schemaVersion 1: unchanged strict path, including a REAL restore drill. */
function verifyStrictAttestation(data, { deploySha, now, maxBackupAgeHours, reject }) {
  const common = verifyCommonFields(data, { deploySha, reject, allowedBackupTypes: ALLOWED_BACKUP_TYPES })
  if (common) return common

  if (data.restoreDrillVerified !== true) return reject('RESTORE_DRILL_NOT_VERIFIED')

  const backupCompletedAt = parseTime(data.backupCompletedAt)
  const restoreDrillAt = parseTime(data.restoreDrillAt)
  const expiresAt = parseTime(data.expiresAt)
  if (backupCompletedAt === null) return reject('BACKUP_COMPLETED_AT_INVALID')
  if (restoreDrillAt === null) return reject('RESTORE_DRILL_AT_INVALID')
  if (expiresAt === null) return reject('EXPIRES_AT_INVALID')

  if (backupCompletedAt > now) return reject('BACKUP_TIME_IN_FUTURE')
  if (now - backupCompletedAt > maxBackupAgeHours * HOUR_MS) return reject('BACKUP_TOO_OLD')
  if (restoreDrillAt > now) return reject('RESTORE_DRILL_TIME_IN_FUTURE')
  if (restoreDrillAt < backupCompletedAt) return reject('RESTORE_DRILL_PRECEDES_BACKUP')
  if (expiresAt <= now) return reject('ATTESTATION_EXPIRED')
  if (expiresAt - now > MAX_ATTESTATION_TTL_HOURS * HOUR_MS) return reject('ATTESTATION_TTL_TOO_LONG')

  return {
    ok: true,
    reason: null,
    evidence: {
      schemaVersion: SCHEMA_VERSION,
      backupId: data.backupId,
      backupType: data.backupType,
      backupCompletedAt: data.backupCompletedAt,
      pitrAvailable: data.pitrAvailable,
      pitrRetentionDays: data.pitrRetentionDays,
      restoreDrillVerified: true,
      restoreDrillWaived: false,
      restoreDrillAt: data.restoreDrillAt,
      waiver: null,
      verifiedBy: data.verifiedBy,
      targetReleaseSha: data.targetReleaseSha,
      expiresAt: data.expiresAt,
      backupAgeMinutes: Math.floor((now - backupCompletedAt) / 60_000),
    },
  }
}

/**
 * schemaVersion 2: waives ONLY the restore-drill requirement, on the strength
 * of an explicit, recent, named, SHA-bound written approval. Everything else
 * remains as strict as schemaVersion 1.
 */
function verifyWaiverAttestation(data, { deploySha, now, maxBackupAgeHours, reject }) {
  const common = verifyCommonFields(data, { deploySha, reject, allowedBackupTypes: WAIVER_ALLOWED_BACKUP_TYPES })
  if (common) return common

  // A drill that never happened must never be recorded as having happened.
  for (const key of FORBIDDEN_DRILL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) return reject('RESTORE_DRILL_RECORD_FORBIDDEN_IN_WAIVER')
  }

  const waiver = data.restoreDrillWaiver
  if (!waiver || typeof waiver !== 'object' || Array.isArray(waiver)) return reject('WAIVER_BLOCK_MISSING')
  for (const field of WAIVER_REQUIRED_FIELDS) {
    if (typeof waiver[field] !== 'string' || waiver[field].trim().length === 0) {
      return reject('WAIVER_FIELD_MISSING')
    }
  }
  if (!SAFE_NAME.test(waiver.approvedBy)) return reject('WAIVER_APPROVED_BY_INVALID')
  if (waiver.riskStatement.trim().length < 8 || waiver.riskStatement.length > 1024) {
    return reject('WAIVER_RISK_STATEMENT_INVALID')
  }
  // One-off: the written approval names exactly ONE release and cannot be
  // replayed for any other commit, including a later re-run of the same PR.
  if (waiver.releaseId !== deploySha) return reject('WAIVER_RELEASE_ID_MISMATCH')

  const backupCompletedAt = parseTime(data.backupCompletedAt)
  const expiresAt = parseTime(data.expiresAt)
  const approvedAt = parseTime(waiver.approvedAt)
  if (backupCompletedAt === null) return reject('BACKUP_COMPLETED_AT_INVALID')
  if (expiresAt === null) return reject('EXPIRES_AT_INVALID')
  if (approvedAt === null) return reject('WAIVER_APPROVED_AT_INVALID')

  if (backupCompletedAt > now) return reject('BACKUP_TIME_IN_FUTURE')
  if (now - backupCompletedAt > maxBackupAgeHours * HOUR_MS) return reject('BACKUP_TOO_OLD')
  if (approvedAt > now) return reject('WAIVER_APPROVED_AT_IN_FUTURE')
  if (now - approvedAt > MAX_WAIVER_AGE_HOURS * HOUR_MS) return reject('WAIVER_APPROVAL_EXPIRED')
  if (approvedAt < backupCompletedAt) return reject('WAIVER_APPROVAL_PRECEDES_BACKUP')
  if (expiresAt <= now) return reject('ATTESTATION_EXPIRED')
  if (expiresAt - now > MAX_ATTESTATION_TTL_HOURS * HOUR_MS) return reject('ATTESTATION_TTL_TOO_LONG')
  if (approvedAt >= expiresAt) return reject('WAIVER_APPROVAL_AFTER_EXPIRY')

  return {
    ok: true,
    reason: null,
    evidence: {
      schemaVersion: WAIVER_SCHEMA_VERSION,
      backupId: data.backupId,
      backupType: data.backupType,
      backupCompletedAt: data.backupCompletedAt,
      pitrAvailable: data.pitrAvailable,
      pitrRetentionDays: data.pitrRetentionDays,
      restoreDrillVerified: false,
      restoreDrillWaived: true,
      restoreDrillAt: null,
      waiver: {
        approvedBy: waiver.approvedBy,
        approvedAt: waiver.approvedAt,
        riskStatement: waiver.riskStatement,
        releaseId: waiver.releaseId,
      },
      verifiedBy: data.verifiedBy,
      targetReleaseSha: data.targetReleaseSha,
      expiresAt: data.expiresAt,
      backupAgeMinutes: Math.floor((now - backupCompletedAt) / 60_000),
    },
  }
}

/**
 * schemaVersion 3: EXPLICIT RISK ACCEPTANCE. The release owner has accepted, in
 * writing, that no independent verification of the CynosDB automatic backup or
 * PITR was obtained and that no restore drill was performed. This path therefore
 * asserts NOTHING about backups: it records the risk as explicitly unverified.
 * It is opt-in via `allowRiskAcceptance`, SHA-bound, short-lived and audited.
 * Fabricating any backup/PITR/drill field inside the attestation is rejected.
 */
function verifyRiskAcceptanceAttestation(data, { deploySha, now, reject }) {
  // Anti-fabrication: a risk-acceptance attestation must not claim any backup,
  // PITR or restore-drill fact that was never independently verified.
  for (const key of RISK_ACCEPTANCE_FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      return reject('RISK_ACCEPTANCE_MUST_NOT_ASSERT_BACKUP')
    }
  }
  if (data.targetReleaseSha !== deploySha) return reject('TARGET_RELEASE_SHA_MISMATCH')
  if (!UUID_V4.test(String(data.attestationId ?? ''))) return reject('RISK_ACCEPTANCE_ATTESTATION_ID_INVALID')
  if (!NUMERIC_ID.test(String(data.issuedByWorkflowRunId ?? ''))) return reject('RISK_ACCEPTANCE_ISSUANCE_RUN_ID_INVALID')

  const expiresAt = parseTime(data.expiresAt)
  if (expiresAt === null) return reject('EXPIRES_AT_INVALID')
  if (expiresAt <= now) return reject('ATTESTATION_EXPIRED')
  if (expiresAt - now > MAX_ATTESTATION_TTL_HOURS * HOUR_MS) return reject('ATTESTATION_TTL_TOO_LONG')

  const risk = data.riskAcceptance
  if (!risk || typeof risk !== 'object' || Array.isArray(risk)) return reject('RISK_ACCEPTANCE_BLOCK_MISSING')
  for (const field of RISK_ACCEPTANCE_REQUIRED_FIELDS) {
    if (typeof risk[field] !== 'string' || risk[field].trim().length === 0) {
      return reject('RISK_ACCEPTANCE_FIELD_MISSING')
    }
  }
  if (risk.approvedBy !== RISK_ACCEPTANCE_APPROVER) return reject('RISK_ACCEPTANCE_APPROVED_BY_INVALID')
  if (!NUMERIC_ID.test(String(risk.approvalCommentId ?? ''))) return reject('RISK_ACCEPTANCE_COMMENT_ID_INVALID')
  if (risk.approvalAuthorAssociation !== 'OWNER') return reject('RISK_ACCEPTANCE_AUTHOR_ASSOCIATION_INVALID')
  if (risk.riskStatement.trim().length < 8 || risk.riskStatement.length > 1024) {
    return reject('RISK_ACCEPTANCE_RISK_STATEMENT_INVALID')
  }
  // One-off: bound to the exact deploy SHA; cannot be replayed for any other
  // commit, including a later re-run of the same PR.
  if (risk.releaseId !== deploySha) return reject('RISK_ACCEPTANCE_RELEASE_ID_MISMATCH')
  // Explicit acknowledgements must be present and true; a missing/!==true flag
  // is rejected so a silent "partial verification" can never be implied.
  if (risk.noIndependentBackupVerification !== true) return reject('RISK_ACCEPTANCE_BACKUP_FLAG_INVALID')
  if (risk.noRestoreDrill !== true) return reject('RISK_ACCEPTANCE_DRILL_FLAG_INVALID')

  const approvedAt = parseTime(risk.approvedAt)
  if (approvedAt === null) return reject('RISK_ACCEPTANCE_APPROVED_AT_INVALID')
  if (approvedAt > now) return reject('RISK_ACCEPTANCE_APPROVED_AT_IN_FUTURE')
  if (now - approvedAt > MAX_WAIVER_AGE_HOURS * HOUR_MS) return reject('RISK_ACCEPTANCE_APPROVAL_EXPIRED')
  if (approvedAt >= expiresAt) return reject('RISK_ACCEPTANCE_APPROVAL_AFTER_EXPIRY')

  return {
    ok: true,
    reason: null,
    evidence: {
      schemaVersion: RISK_ACCEPTANCE_SCHEMA_VERSION,
      backupVerified: false,
      pitrVerified: false,
      restoreDrillVerified: false,
      restoreDrillWaived: true,
      riskAccepted: true,
      riskAcceptance: {
        approvedBy: risk.approvedBy,
        approvedAt: risk.approvedAt,
        approvalCommentId: risk.approvalCommentId,
        approvalAuthorAssociation: risk.approvalAuthorAssociation,
        riskStatement: risk.riskStatement,
        releaseId: risk.releaseId,
        noIndependentBackupVerification: true,
        noRestoreDrill: true,
      },
      attestationId: data.attestationId,
      issuedByWorkflowRunId: String(data.issuedByWorkflowRunId),
      targetReleaseSha: data.targetReleaseSha,
      expiresAt: data.expiresAt,
    },
  }
}

/**
 * Pure, unit-testable verification. `context` carries the release identity,
 * an injectable clock and the explicit workflow-level waiver switch.
 */
export function verifyBackupAttestation(rawText, context) {
  const reject = (reason) => ({ ok: false, reason, evidence: null })
  const {
    deploySha,
    now = Date.now(),
    maxBackupAgeHours = DEFAULT_MAX_BACKUP_AGE_HOURS,
    allowRestoreDrillWaiver = false,
    allowRiskAcceptance = false,
  } = context

  if (!SHA40.test(String(deploySha ?? ''))) return reject('DEPLOY_SHA_INVALID')
  if (typeof rawText !== 'string' || rawText.trim().length === 0) return reject('ATTESTATION_EMPTY')

  let data
  try {
    data = JSON.parse(rawText)
  } catch {
    return reject('ATTESTATION_INVALID_JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return reject('ATTESTATION_INVALID_SHAPE')

  const effectiveMaxAge = Number.isFinite(maxBackupAgeHours) && maxBackupAgeHours > 0
    ? maxBackupAgeHours
    : DEFAULT_MAX_BACKUP_AGE_HOURS
  const shared = { deploySha, now, maxBackupAgeHours: effectiveMaxAge, reject }

  if (data.schemaVersion === SCHEMA_VERSION) return verifyStrictAttestation(data, shared)
  if (data.schemaVersion === WAIVER_SCHEMA_VERSION) {
    // Defence in depth: the host-side attestation alone is not enough. The
    // reviewed deployment workflow must explicitly opt in for this release.
    if (allowRestoreDrillWaiver !== true) return reject('WAIVER_NOT_ENABLED')
    return verifyWaiverAttestation(data, shared)
  }
  if (data.schemaVersion === RISK_ACCEPTANCE_SCHEMA_VERSION) {
    // The narrowest door: the release owner explicitly accepts, in writing, that
    // no independent backup/PITR verification and no restore drill were done. It
    // can only be taken when the reviewed workflow opts in for this release.
    if (allowRiskAcceptance !== true) return reject('RISK_ACCEPTANCE_NOT_ENABLED')
    return verifyRiskAcceptanceAttestation(data, shared)
  }
  return reject('SCHEMA_VERSION_UNSUPPORTED')
}

/**
 * Read-only host-side checks: regular file, not a symlink, not group/world
 * writable, owned by the deploy user. Extracted as a pure function so the
 * POSIX-only rules are unit-testable on Windows CI/dev machines.
 */
export function assertAttestationFileStat(stats, options = {}) {
  const platform = options.platform ?? process.platform
  const uid = options.uid ?? (typeof process.getuid === 'function' ? process.getuid() : undefined)
  if (!stats.isFile() || (typeof stats.isSymbolicLink === 'function' && stats.isSymbolicLink())) {
    throw new Error('ATTESTATION_NOT_A_REGULAR_FILE')
  }
  // POSIX mode bits are meaningless on NTFS (Windows ACLs), so the strict
  // group/world-writable and owner checks apply on the POSIX production host
  // only. They are never relaxed there.
  if (platform !== 'win32') {
    if ((stats.mode & 0o022) !== 0) throw new Error('ATTESTATION_UNSAFE_PERMISSIONS')
    if (uid !== undefined && stats.uid !== uid) throw new Error('ATTESTATION_UNEXPECTED_OWNER')
  }
  return true
}

export function readAttestationFile(filePath) {
  const stats = lstatSync(filePath)
  assertAttestationFileStat(stats)
  return readFileSync(filePath, 'utf8')
}

function assertPrivateFileStat(stats) {
  assertAttestationFileStat(stats)
  if (process.platform !== 'win32' && (stats.mode & 0o077) !== 0) {
    throw new Error('ATTESTATION_PRIVATE_FILE_PERMISSIONS_REQUIRED')
  }
}

function assertPrivateDirectoryStat(stats) {
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('ATTESTATION_STATE_NOT_A_DIRECTORY')
  if (process.platform !== 'win32') {
    if ((stats.mode & 0o077) !== 0) throw new Error('ATTESTATION_STATE_UNSAFE_PERMISSIONS')
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
      throw new Error('ATTESTATION_STATE_UNEXPECTED_OWNER')
    }
  }
}

function assertSafeAttestationPath(filePath) {
  const isWindowsTestPath = process.platform === 'win32' && /^[A-Za-z]:[\\/]/.test(String(filePath ?? ''))
  if (typeof filePath !== 'string' || (!filePath.startsWith('/') && !isWindowsTestPath) || filePath.includes('..')) {
    throw new Error('ATTESTATION_PATH_INVALID')
  }
  const parent = dirname(filePath)
  if (realpathSync(parent) !== resolve(parent)) throw new Error('ATTESTATION_PATH_PARENT_NOT_CANONICAL')
}

function statePathsFor(attestationPath) {
  const root = `${attestationPath}.state`
  return { root, issued: join(root, 'issued'), consumed: join(root, 'consumed'), archived: join(root, 'archived') }
}

function secureDirectory(dirPath, { create }) {
  if (create) {
    try {
      mkdirSync(dirPath, { mode: 0o700 })
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
  }
  const stats = lstatSync(dirPath)
  assertPrivateDirectoryStat(stats)
  return dirPath
}

function ensureStateLayout(attestationPath, { create }) {
  const paths = statePathsFor(attestationPath)
  secureDirectory(paths.root, { create })
  secureDirectory(paths.issued, { create })
  secureDirectory(paths.consumed, { create })
  secureDirectory(paths.archived, { create })
  return paths
}

function fsyncDirectory(dirPath) {
  if (process.platform === 'win32') return
  const descriptor = openSync(dirPath, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

/** Atomic no-replace creation using a same-directory temporary file and hard link. */
export function createExclusiveAtomic(filePath, contents) {
  const dirPath = dirname(filePath)
  const temporaryPath = join(dirPath, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  let descriptor
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600)
    writeFileSync(descriptor, contents, 'utf8')
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    linkSync(temporaryPath, filePath)
    unlinkSync(temporaryPath)
    fsyncDirectory(dirPath)
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch {}
    }
    try { unlinkSync(temporaryPath) } catch {}
    if (error?.code === 'EEXIST') throw new Error('ATTESTATION_TARGET_ALREADY_EXISTS')
    throw error
  }
}

function hasPath(filePath) {
  try {
    lstatSync(filePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function readPrivateJson(filePath, errorCode) {
  const stats = lstatSync(filePath)
  assertPrivateFileStat(stats)
  let parsed
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    throw new Error(errorCode)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(errorCode)
  return parsed
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function parseJsonPayload(base64Text) {
  if (typeof base64Text !== 'string' || base64Text.length === 0 || base64Text.length > 64_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Text)) {
    throw new Error('ATTESTATION_PAYLOAD_INVALID')
  }
  let text
  try {
    text = Buffer.from(base64Text, 'base64').toString('utf8')
  } catch {
    throw new Error('ATTESTATION_PAYLOAD_INVALID')
  }
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    if (Buffer.from(text, 'utf8').toString('base64') !== base64Text) throw new Error()
    return { text: `${JSON.stringify(data, null, 2)}\n`, data }
  } catch {
    throw new Error('ATTESTATION_PAYLOAD_INVALID')
  }
}

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index])
}

/** Create a schema v3 proof and immutable issuance ledger; never replace either. */
export function issueRiskAcceptance({ attestationPath, deploySha, payloadBase64, workflowRunId, now = Date.now() }) {
  assertSafeAttestationPath(attestationPath)
  if (!NUMERIC_ID.test(String(workflowRunId ?? ''))) throw new Error('ISSUANCE_RUN_ID_INVALID')
  const { text, data } = parseJsonPayload(payloadBase64)
  if (!hasExactKeys(data, ['schemaVersion', 'attestationId', 'issuedByWorkflowRunId', 'targetReleaseSha', 'expiresAt', 'riskAcceptance']) ||
      !hasExactKeys(data.riskAcceptance, [
        'approvedBy', 'approvedAt', 'approvalCommentId', 'approvalAuthorAssociation', 'riskStatement', 'releaseId',
        'noIndependentBackupVerification', 'noRestoreDrill',
      ])) {
    throw new Error('ATTESTATION_PAYLOAD_FIELDS_INVALID')
  }
  if (String(data.issuedByWorkflowRunId) !== String(workflowRunId)) throw new Error('ISSUANCE_RUN_ID_MISMATCH')
  const verified = verifyBackupAttestation(text, { deploySha, now, allowRiskAcceptance: true })
  if (!verified.ok || verified.evidence?.schemaVersion !== RISK_ACCEPTANCE_SCHEMA_VERSION) {
    throw new Error(verified.reason ?? 'RISK_ACCEPTANCE_SCHEMA_INVALID')
  }
  const expiresAt = Date.parse(data.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt - now > 60 * 60 * 1000) {
    throw new Error('ISSUANCE_TTL_EXCEEDS_ONE_HOUR')
  }
  const state = ensureStateLayout(attestationPath, { create: true })
  const risk = data.riskAcceptance
  const issuedPath = join(state.issued, `${risk.approvalCommentId}.json`)
  const consumedPath = join(state.consumed, `${risk.approvalCommentId}.json`)
  if (hasPath(issuedPath) || hasPath(consumedPath)) throw new Error('APPROVAL_COMMENT_ALREADY_USED')

  if (hasPath(attestationPath)) archiveExistingRiskAcceptance({
    attestationPath,
    state,
    deploySha,
    replacementCommentId: risk.approvalCommentId,
    replacementRunId: String(workflowRunId),
    now,
  })

  createExclusiveAtomic(attestationPath, text)
  const record = {
    schemaVersion: 1,
    targetReleaseSha: deploySha,
    approvalCommentId: risk.approvalCommentId,
    approvedBy: risk.approvedBy,
    approvalAuthorAssociation: risk.approvalAuthorAssociation,
    approvedAt: risk.approvedAt,
    attestationId: data.attestationId,
    issuedByWorkflowRunId: String(workflowRunId),
    issuedAt: new Date(now).toISOString(),
    proofSha256: sha256(text),
  }
  try {
    createExclusiveAtomic(issuedPath, `${JSON.stringify(record, null, 2)}\n`)
  } catch {
    // The proof remains in place and unusable without its issuance ledger.
    // Never remove or overwrite it automatically; recovery is an audited operator action.
    throw new Error('ISSUANCE_LEDGER_CREATE_FAILED_PROOF_REQUIRES_AUDIT')
  }
  try {
    assertPrivateFileStat(lstatSync(attestationPath))
    const readBackText = readFileSync(attestationPath, 'utf8')
    const readBack = verifyBackupAttestation(readBackText, { deploySha, now, allowRiskAcceptance: true })
    const readBackRecord = readPrivateJson(issuedPath, 'ISSUANCE_RECORD_INVALID')
    if (readBackText !== text || !readBack.ok || readBack.evidence?.schemaVersion !== RISK_ACCEPTANCE_SCHEMA_VERSION) {
      throw new Error('ISSUED_PROOF_READBACK_MISMATCH')
    }
    verifyIssuanceRecord(readBackRecord, { data, deploySha, proofSha256: sha256(readBackText) })
  } catch {
    // Leave all created evidence intact for audit; never retry by overwriting it.
    throw new Error('ISSUED_PROOF_READBACK_FAILED_REQUIRES_AUDIT')
  }
  return { attestationId: data.attestationId, approvalCommentId: risk.approvalCommentId, proofSha256: record.proofSha256 }
}

function verifyIssuanceRecord(record, { data, deploySha, proofSha256 }) {
  const risk = data.riskAcceptance
  if (record.schemaVersion !== 1 || record.targetReleaseSha !== deploySha ||
      record.approvalCommentId !== risk.approvalCommentId || record.approvedBy !== risk.approvedBy ||
      record.approvalAuthorAssociation !== risk.approvalAuthorAssociation || record.approvedAt !== risk.approvedAt ||
      record.attestationId !== data.attestationId || record.proofSha256 !== proofSha256 ||
      record.issuedByWorkflowRunId !== String(data.issuedByWorkflowRunId) ||
      !NUMERIC_ID.test(String(record.issuedByWorkflowRunId ?? '')) ||
      !Number.isFinite(Date.parse(record.issuedAt))) {
    throw new Error('ISSUANCE_RECORD_MISMATCH')
  }
}

function archiveExistingRiskAcceptance({ attestationPath, state, deploySha, replacementCommentId, replacementRunId, now }) {
  assertPrivateFileStat(lstatSync(attestationPath))
  const oldText = readFileSync(attestationPath, 'utf8')
  let oldData
  try {
    oldData = JSON.parse(oldText)
  } catch {
    throw new Error('EXISTING_ATTESTATION_UNKNOWN_REFUSING_REPLACEMENT')
  }
  const oldRisk = oldData?.riskAcceptance
  const oldDeploySha = String(oldData?.targetReleaseSha ?? '')
  if (oldData?.schemaVersion !== RISK_ACCEPTANCE_SCHEMA_VERSION || !SHA40.test(oldDeploySha) ||
      oldRisk?.releaseId !== oldDeploySha ||
      !UUID_V4.test(String(oldData.attestationId ?? '')) ||
      !oldRisk || !NUMERIC_ID.test(String(oldRisk.approvalCommentId ?? '')) || oldRisk.approvedBy !== RISK_ACCEPTANCE_APPROVER) {
    throw new Error('EXISTING_ATTESTATION_UNKNOWN_REFUSING_REPLACEMENT')
  }
  const oldDigest = sha256(oldText)
  const issuedPath = join(state.issued, `${oldRisk.approvalCommentId}.json`)
  const issuance = readPrivateJson(issuedPath, 'EXISTING_ISSUANCE_RECORD_INVALID')
  verifyIssuanceRecord(issuance, { data: oldData, deploySha: oldDeploySha, proofSha256: oldDigest })

  const consumedPath = join(state.consumed, `${oldRisk.approvalCommentId}.json`)
  let consumedRecord = null
  if (hasPath(consumedPath)) {
    consumedRecord = readPrivateJson(consumedPath, 'EXISTING_CONSUMPTION_RECORD_INVALID')
    if (consumedRecord.schemaVersion !== 1 || consumedRecord.targetReleaseSha !== oldDeploySha ||
        consumedRecord.approvalCommentId !== oldRisk.approvalCommentId ||
        consumedRecord.attestationId !== oldData.attestationId || consumedRecord.proofSha256 !== oldDigest ||
        consumedRecord.approvedBy !== oldRisk.approvedBy || consumedRecord.approvedAt !== oldRisk.approvedAt ||
        !NUMERIC_ID.test(String(consumedRecord.runId ?? '')) ||
        !/^[1-9][0-9]{0,5}$/.test(String(consumedRecord.runAttempt ?? '')) ||
        !Number.isFinite(Date.parse(consumedRecord.consumedAt))) {
      throw new Error('EXISTING_CONSUMPTION_RECORD_INVALID')
    }
  } else {
    const oldExpiry = Date.parse(oldData.expiresAt)
    if (!Number.isFinite(oldExpiry) || oldExpiry > now) throw new Error('ACTIVE_ATTESTATION_NOT_CONSUMED')
  }

  const archiveProofPath = join(state.archived, `${oldData.attestationId}.json`)
  const archiveRecordPath = join(state.archived, `${oldData.attestationId}.archive.json`)
  const archiveRecord = {
    schemaVersion: 1,
    reason: consumedRecord ? 'REAPPROVED_AFTER_CONSUMPTION' : 'EXPIRED_UNCONSUMED',
    archivedTargetReleaseSha: oldDeploySha,
    replacementTargetReleaseSha: deploySha,
    archivedAttestationId: oldData.attestationId,
    archivedApprovalCommentId: oldRisk.approvalCommentId,
    archivedProofSha256: oldDigest,
    consumedRunId: consumedRecord?.runId ?? null,
    consumedRunAttempt: consumedRecord?.runAttempt ?? null,
    replacementApprovalCommentId: replacementCommentId,
    replacementIssuanceRunId: replacementRunId,
    archivedAt: new Date(now).toISOString(),
  }
  try {
    linkSync(attestationPath, archiveProofPath)
    fsyncDirectory(state.archived)
    createExclusiveAtomic(archiveRecordPath, `${JSON.stringify(archiveRecord, null, 2)}\n`)
    unlinkSync(attestationPath)
    fsyncDirectory(dirname(attestationPath))
  } catch (error) {
    // Never roll back or delete the old proof/consumption records automatically.
    if (error?.message === 'ATTESTATION_TARGET_ALREADY_EXISTS' || error?.code === 'EEXIST') {
      throw new Error('ATTESTATION_ARCHIVE_ALREADY_EXISTS')
    }
    throw new Error('ATTESTATION_ARCHIVE_FAILED_REQUIRES_AUDIT')
  }
}

/** Persist an irreversible schema v3 use marker bound to the exact GitHub run and proof. */
export function consumeRiskAcceptance({ attestationPath, deploySha, runId, runAttempt, now = Date.now() }) {
  assertSafeAttestationPath(attestationPath)
  if (!NUMERIC_ID.test(String(runId ?? '')) || !/^[1-9][0-9]{0,5}$/.test(String(runAttempt ?? ''))) {
    throw new Error('DEPLOY_RUN_ID_INVALID')
  }
  const rawText = readAttestationFile(attestationPath)
  const verified = verifyBackupAttestation(rawText, { deploySha, now, allowRiskAcceptance: true })
  if (!verified.ok) throw new Error(verified.reason)
  if (verified.evidence?.schemaVersion !== RISK_ACCEPTANCE_SCHEMA_VERSION) {
    return { consumed: false, evidence: verified.evidence }
  }
  assertPrivateFileStat(lstatSync(attestationPath))

  const data = JSON.parse(rawText)
  const risk = data.riskAcceptance
  const state = ensureStateLayout(attestationPath, { create: false })
  const issuedPath = join(state.issued, `${risk.approvalCommentId}.json`)
  const consumedPath = join(state.consumed, `${risk.approvalCommentId}.json`)
  const proofDigest = sha256(rawText)
  const issuance = readPrivateJson(issuedPath, 'ISSUANCE_RECORD_INVALID')
  verifyIssuanceRecord(issuance, { data, deploySha, proofSha256: proofDigest })
  if (hasPath(consumedPath)) throw new Error('RISK_ACCEPTANCE_ALREADY_CONSUMED')

  const record = {
    schemaVersion: 1,
    targetReleaseSha: deploySha,
    runId: String(runId),
    runAttempt: String(runAttempt),
    attestationId: data.attestationId,
    approvalCommentId: risk.approvalCommentId,
    approvedBy: risk.approvedBy,
    approvedAt: risk.approvedAt,
    proofSha256: proofDigest,
    consumedAt: new Date(now).toISOString(),
  }
  try {
    createExclusiveAtomic(consumedPath, `${JSON.stringify(record, null, 2)}\n`)
  } catch (error) {
    if (error?.message === 'ATTESTATION_TARGET_ALREADY_EXISTS') throw new Error('RISK_ACCEPTANCE_ALREADY_CONSUMED')
    throw new Error('RISK_ACCEPTANCE_CONSUMPTION_FAILED')
  }
  return { consumed: true, evidence: verified.evidence, record }
}

function parseArgs(argv) {
  const options = { command: argv[0] ?? '' }
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      options[key] = true
    } else {
      options[key] = value
      index += 1
    }
  }
  return options
}

function emitRejected(reason) {
  console.log('BACKUP_GATE=REJECTED')
  console.log(`BACKUP_GATE_REASON=${reason}`)
  console.log('BACKUP_PITR_VERIFIED=NO')
  console.log('RESTORE_DRILL_VERIFIED=NO')
  console.log('RESTORE_DRILL_WAIVED=NO')
  console.log('BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT')
  return 1
}

function loadVerifiedAttestation(options) {
  const attestationPath = String(options.attestation ?? '')
  const deploySha = String(options['deploy-sha'] ?? '')
  const nowOption = options.now
  const maxBackupAgeHours = Number(options['max-backup-age-hours'] ?? DEFAULT_MAX_BACKUP_AGE_HOURS)
  const waiverMode = String(options['waiver-mode'] ?? WAIVER_MODE_NONE)
  const riskMode = String(options['risk-acceptance-mode'] ?? RISK_ACCEPTANCE_MODE_NONE)

  if (!SUPPORTED_WAIVER_MODES.includes(waiverMode)) return { ok: false, reason: 'WAIVER_MODE_INVALID' }
  if (!SUPPORTED_RISK_ACCEPTANCE_MODES.includes(riskMode)) return { ok: false, reason: 'RISK_ACCEPTANCE_MODE_INVALID' }

  // Production is POSIX. Windows-style absolute paths are accepted only so the
  // gate can be smoke-tested on a developer machine; relative paths and any
  // traversal component are always refused.
  const isPosixAbsolute = attestationPath.startsWith('/')
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(attestationPath)
  if ((!isPosixAbsolute && !isWindowsAbsolute) || attestationPath.includes('..')) {
    return { ok: false, reason: 'ATTESTATION_PATH_INVALID' }
  }

  let rawText
  try {
    rawText = readAttestationFile(attestationPath)
  } catch (error) {
    return { ok: false, reason: error.message ?? String(error) }
  }

  const parsedNow = typeof nowOption === 'string' ? Date.parse(nowOption) : Date.now()
  const result = verifyBackupAttestation(rawText, {
    deploySha,
    now: Number.isFinite(parsedNow) ? parsedNow : Date.now(),
    maxBackupAgeHours: Number.isFinite(maxBackupAgeHours) && maxBackupAgeHours > 0
      ? maxBackupAgeHours
      : DEFAULT_MAX_BACKUP_AGE_HOURS,
    allowRestoreDrillWaiver: waiverMode === WAIVER_MODE_APPROVED,
    allowRiskAcceptance: riskMode === RISK_ACCEPTANCE_MODE_APPROVED,
  })

  if (!result.ok) return { ok: false, reason: result.reason }
  return { ok: true, attestationPath, deploySha, rawText, evidence: result.evidence }
}

function emitVerified(evidence, consumption = null) {
  console.log('BACKUP_GATE=VERIFIED')
  console.log(`BACKUP_GATE_SCHEMA_VERSION=${evidence.schemaVersion}`)
  if (evidence.schemaVersion === RISK_ACCEPTANCE_SCHEMA_VERSION) {
    // Explicit, audited risk acceptance: NO backup/PITR was independently
    // verified and no restore drill was performed. This is printed so nobody
    // can mistake the release for a verified-recoverable deployment.
    console.log('BACKUP_VERIFIED=NO')
    console.log('BACKUP_PITR_VERIFIED=NO')
    console.log('RESTORE_DRILL_VERIFIED=NO')
    console.log('RESTORE_DRILL_WAIVED=YES')
    console.log('RISK_ACCEPTED=YES')
    console.log(`RISK_ACCEPTANCE_APPROVED_BY=${evidence.riskAcceptance.approvedBy}`)
    console.log(`RISK_ACCEPTANCE_APPROVED_AT=${evidence.riskAcceptance.approvedAt}`)
    console.log(`RISK_ACCEPTANCE_RELEASE_ID=${evidence.riskAcceptance.releaseId}`)
    console.log('RISK_ACCEPTANCE_NO_INDEPENDENT_BACKUP_VERIFICATION=YES')
    console.log('RISK_ACCEPTANCE_NO_RESTORE_DRILL=YES')
    console.log(`BACKUP_ATTESTATION_TARGET_SHA=${evidence.targetReleaseSha}`)
    console.log(`BACKUP_ATTESTATION_EXPIRES_AT=${evidence.expiresAt}`)
  } else if (evidence.schemaVersion === WAIVER_SCHEMA_VERSION) {
    console.log(`BACKUP_ID=${evidence.backupId}`)
    console.log(`BACKUP_TYPE=${evidence.backupType}`)
    console.log(`BACKUP_COMPLETED_AT=${evidence.backupCompletedAt}`)
    console.log(`BACKUP_AGE_MINUTES=${evidence.backupAgeMinutes}`)
    console.log('BACKUP_PITR_VERIFIED=YES')
    console.log(`BACKUP_PITR_RETENTION_DAYS=${evidence.pitrRetentionDays}`)
    // Never ambiguous: "waived" is printed as NOT verified.
    console.log('RESTORE_DRILL_VERIFIED=NO')
    console.log('RESTORE_DRILL_WAIVED=YES')
    console.log(`RESTORE_DRILL_WAIVER_APPROVED_BY=${evidence.waiver.approvedBy}`)
    console.log(`RESTORE_DRILL_WAIVER_APPROVED_AT=${evidence.waiver.approvedAt}`)
    console.log(`RESTORE_DRILL_WAIVER_RELEASE_ID=${evidence.waiver.releaseId}`)
    console.log('RESTORE_DRILL_WAIVER_RISK_ACCEPTED=YES')
    console.log(`BACKUP_VERIFIED_BY=${evidence.verifiedBy}`)
    console.log(`BACKUP_ATTESTATION_TARGET_SHA=${evidence.targetReleaseSha}`)
    console.log(`BACKUP_ATTESTATION_EXPIRES_AT=${evidence.expiresAt}`)
  } else {
    console.log(`BACKUP_ID=${evidence.backupId}`)
    console.log(`BACKUP_TYPE=${evidence.backupType}`)
    console.log(`BACKUP_COMPLETED_AT=${evidence.backupCompletedAt}`)
    console.log(`BACKUP_AGE_MINUTES=${evidence.backupAgeMinutes}`)
    console.log('BACKUP_PITR_VERIFIED=YES')
    console.log(`BACKUP_PITR_RETENTION_DAYS=${evidence.pitrRetentionDays}`)
    console.log('RESTORE_DRILL_VERIFIED=YES')
    console.log('RESTORE_DRILL_WAIVED=NO')
    console.log(`RESTORE_DRILL_AT=${evidence.restoreDrillAt}`)
    console.log(`BACKUP_VERIFIED_BY=${evidence.verifiedBy}`)
    console.log(`BACKUP_ATTESTATION_TARGET_SHA=${evidence.targetReleaseSha}`)
    console.log(`BACKUP_ATTESTATION_EXPIRES_AT=${evidence.expiresAt}`)
  }
  if (consumption?.consumed) {
    console.log('RISK_ACCEPTANCE_CONSUMED=YES')
    console.log(`RISK_ACCEPTANCE_CONSUMED_RUN_ID=${consumption.record.runId}`)
    console.log(`RISK_ACCEPTANCE_CONSUMED_RUN_ATTEMPT=${consumption.record.runAttempt}`)
    console.log(`RISK_ACCEPTANCE_ATTESTATION_ID=${consumption.record.attestationId}`)
  }
  return 0
}

function verifyOnHost(options) {
  const loaded = loadVerifiedAttestation(options)
  if (!loaded.ok) return emitRejected(loaded.reason)
  return emitVerified(loaded.evidence)
}

function consumeOnHost(options) {
  const loaded = loadVerifiedAttestation(options)
  if (!loaded.ok) return emitRejected(loaded.reason)
  if (loaded.evidence.schemaVersion !== RISK_ACCEPTANCE_SCHEMA_VERSION) return emitVerified(loaded.evidence)
  try {
    const consumption = consumeRiskAcceptance({
      attestationPath: loaded.attestationPath,
      deploySha: loaded.deploySha,
      runId: String(options['run-id'] ?? ''),
      runAttempt: String(options['run-attempt'] ?? ''),
    })
    if (!consumption.consumed) return emitRejected('RISK_ACCEPTANCE_CONSUMPTION_REQUIRED')
    return emitVerified(loaded.evidence, consumption)
  } catch (error) {
    const reason = /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'RISK_ACCEPTANCE_CONSUMPTION_FAILED'
    return emitRejected(reason)
  }
}

function issueOnHost(options) {
  try {
    const result = issueRiskAcceptance({
      attestationPath: String(options.attestation ?? ''),
      deploySha: String(options['deploy-sha'] ?? ''),
      payloadBase64: String(options['payload-base64'] ?? ''),
      workflowRunId: String(options['workflow-run-id'] ?? ''),
    })
    console.log('RISK_ACCEPTANCE_ATTESTATION=ISSUED')
    console.log(`RISK_ACCEPTANCE_ATTESTATION_ID=${result.attestationId}`)
    console.log(`RISK_ACCEPTANCE_APPROVAL_COMMENT_ID=${result.approvalCommentId}`)
    console.log(`RISK_ACCEPTANCE_TARGET_SHA=${String(options['deploy-sha'])}`)
    console.log(`RISK_ACCEPTANCE_PROOF_SHA256=${result.proofSha256}`)
    return 0
  } catch (error) {
    const reason = /^[A-Z0-9_]+$/.test(error?.message ?? '') ? error.message : 'RISK_ACCEPTANCE_ISSUANCE_FAILED'
    console.log('RISK_ACCEPTANCE_ATTESTATION=REJECTED')
    console.log(`RISK_ACCEPTANCE_ISSUANCE_REASON=${reason}`)
    return 1
  }
}

async function main() {
  const cliArgs = process.argv.slice(2)
  const marker = cliArgs.indexOf('--cli')
  const options = parseArgs(marker === -1 ? cliArgs : cliArgs.slice(marker + 1))
  if (options.command === 'verify') return verifyOnHost(options)
  if (options.command === 'consume') return consumeOnHost(options)
  if (options.command === 'issue') return issueOnHost(options)
  throw new Error(`Unknown command: ${options.command || '(none)'}`)
}

const invokedAsScript = (process.argv[1] ?? '').endsWith('production-backup-gate.mjs')
if (process.argv.includes('--cli') || invokedAsScript) {
  // Deliberately avoid top-level await for the same tsx CJS-transform reason.
  Promise.resolve()
    .then(() => main())
    .then((code) => { process.exitCode = code })
    .catch(() => {
      console.log('BACKUP_GATE=REJECTED')
      console.log('BACKUP_GATE_REASON=GATE_ERROR')
      console.log('BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT')
      process.exitCode = 1
    })
}
