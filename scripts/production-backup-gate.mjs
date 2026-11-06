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

import { lstatSync, readFileSync } from 'node:fs'

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

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_NAME = /^[A-Za-z0-9._@-]{1,64}$/
const SHA40 = /^[0-9a-f]{40}$/
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

function verifyOnHost(options) {
  const attestationPath = String(options.attestation ?? '')
  const deploySha = String(options['deploy-sha'] ?? '')
  const nowOption = options.now
  const maxBackupAgeHours = Number(options['max-backup-age-hours'] ?? DEFAULT_MAX_BACKUP_AGE_HOURS)
  const waiverMode = String(options['waiver-mode'] ?? WAIVER_MODE_NONE)

  if (!SUPPORTED_WAIVER_MODES.includes(waiverMode)) return emitRejected('WAIVER_MODE_INVALID')

  // Production is POSIX. Windows-style absolute paths are accepted only so the
  // gate can be smoke-tested on a developer machine; relative paths and any
  // traversal component are always refused.
  const isPosixAbsolute = attestationPath.startsWith('/')
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(attestationPath)
  if ((!isPosixAbsolute && !isWindowsAbsolute) || attestationPath.includes('..')) {
    return emitRejected('ATTESTATION_PATH_INVALID')
  }

  let rawText
  try {
    rawText = readAttestationFile(attestationPath)
  } catch (error) {
    return emitRejected(error.message ?? String(error))
  }

  const parsedNow = typeof nowOption === 'string' ? Date.parse(nowOption) : Date.now()
  const result = verifyBackupAttestation(rawText, {
    deploySha,
    now: Number.isFinite(parsedNow) ? parsedNow : Date.now(),
    maxBackupAgeHours: Number.isFinite(maxBackupAgeHours) && maxBackupAgeHours > 0
      ? maxBackupAgeHours
      : DEFAULT_MAX_BACKUP_AGE_HOURS,
    allowRestoreDrillWaiver: waiverMode === WAIVER_MODE_APPROVED,
  })

  if (!result.ok) return emitRejected(result.reason)

  const evidence = result.evidence
  console.log('BACKUP_GATE=VERIFIED')
  console.log(`BACKUP_GATE_SCHEMA_VERSION=${evidence.schemaVersion}`)
  console.log(`BACKUP_ID=${evidence.backupId}`)
  console.log(`BACKUP_TYPE=${evidence.backupType}`)
  console.log(`BACKUP_COMPLETED_AT=${evidence.backupCompletedAt}`)
  console.log(`BACKUP_AGE_MINUTES=${evidence.backupAgeMinutes}`)
  console.log('BACKUP_PITR_VERIFIED=YES')
  console.log(`BACKUP_PITR_RETENTION_DAYS=${evidence.pitrRetentionDays}`)
  if (evidence.schemaVersion === WAIVER_SCHEMA_VERSION) {
    // Never ambiguous: "waived" is printed as NOT verified.
    console.log('RESTORE_DRILL_VERIFIED=NO')
    console.log('RESTORE_DRILL_WAIVED=YES')
    console.log(`RESTORE_DRILL_WAIVER_APPROVED_BY=${evidence.waiver.approvedBy}`)
    console.log(`RESTORE_DRILL_WAIVER_APPROVED_AT=${evidence.waiver.approvedAt}`)
    console.log(`RESTORE_DRILL_WAIVER_RELEASE_ID=${evidence.waiver.releaseId}`)
    console.log('RESTORE_DRILL_WAIVER_RISK_ACCEPTED=YES')
  } else {
    console.log('RESTORE_DRILL_VERIFIED=YES')
    console.log('RESTORE_DRILL_WAIVED=NO')
    console.log(`RESTORE_DRILL_AT=${evidence.restoreDrillAt}`)
  }
  console.log(`BACKUP_VERIFIED_BY=${evidence.verifiedBy}`)
  console.log(`BACKUP_ATTESTATION_TARGET_SHA=${evidence.targetReleaseSha}`)
  console.log(`BACKUP_ATTESTATION_EXPIRES_AT=${evidence.expiresAt}`)
  return 0
}

async function main() {
  const cliArgs = process.argv.slice(2)
  const marker = cliArgs.indexOf('--cli')
  const options = parseArgs(marker === -1 ? cliArgs : cliArgs.slice(marker + 1))
  if (options.command === 'verify') return verifyOnHost(options)
  throw new Error(`Unknown command: ${options.command || '(none)'}`)
}

const invokedAsScript = (process.argv[1] ?? '').endsWith('production-backup-gate.mjs')
if (process.argv.includes('--cli') || invokedAsScript) {
  // Deliberately avoid top-level await for the same tsx CJS-transform reason.
  Promise.resolve()
    .then(() => main())
    .then((code) => { process.exitCode = code })
    .catch((error) => {
      console.log('BACKUP_GATE=REJECTED')
      console.log(`BACKUP_GATE_REASON=GATE_ERROR ${error.message ?? error}`)
      console.log('BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT')
      process.exitCode = 1
    })
}
