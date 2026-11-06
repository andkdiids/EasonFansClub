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
 * ATTESTATION FILE (written on the production host, e.g.
 * /home/apps/easonfansclub/shared/.backup-verification.json, mode 0600,
 * owned by the deploy user, NOT a symlink). It contains NO credentials:
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
 * MINIMUM HUMAN PROCEDURE before any production deployment:
 *   1. In the Tencent Cloud CynosDB console, confirm automatic backup is
 *      enabled, note the retention period, and identify the most recent
 *      SUCCESSFUL snapshot for the `easonfansclub` cluster.
 *   2. Confirm PITR is enabled and note the retention window in days.
 *   3. Perform (or review) a real restore drill into a separate instance and
 *      record the time it was verified. A snapshot that has never been
 *      restored is NOT a verified backup.
 *   4. Write the attestation above with the exact release SHA and a short
 *      expiry, then `chmod 600` it and ensure it is owned by the deploy user.
 *   5. Re-run the deployment. The gate re-reads the attestation on the host;
 *      an expired, stale, mismatched or un-drilled attestation always fails.
 *
 * The gate never reads DATABASE_URL, never prints any environment value and
 * never touches the database. `prisma migrate deploy` and the atomic switch
 * are downstream of this gate in both deploy.yml and deploy-production-git.sh.
 *
 * Usage:
 *   node scripts/production-backup-gate.mjs --cli verify \
 *     --attestation <path> --deploy-sha <40-hex> [--now <iso>] \
 *     [--max-backup-age-hours 24]
 *   # Also usable via stdin on the production host:
 *   # cat scripts/production-backup-gate.mjs | ssh <host> \
 *   #   node --input-type=module - --cli verify --attestation <path> --deploy-sha <sha>
 */

import { lstatSync, readFileSync } from 'node:fs'

export const SCHEMA_VERSION = 1
export const DEFAULT_MAX_BACKUP_AGE_HOURS = 24
export const MAX_ATTESTATION_TTL_HOURS = 24
export const ALLOWED_BACKUP_TYPES = ['AUTOMATED_SNAPSHOT', 'MANUAL_SNAPSHOT', 'PITR_SNAPSHOT']

const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/
const SAFE_NAME = /^[A-Za-z0-9._@-]{1,64}$/
const SHA40 = /^[0-9a-f]{40}$/
const HOUR_MS = 3_600_000

function parseTime(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Pure, unit-testable verification. `context` carries the release identity and
 * an injectable clock so the gate can be tested without touching a real host.
 */
export function verifyBackupAttestation(rawText, context) {
  const reject = (reason) => ({ ok: false, reason, evidence: null })
  const { deploySha, now = Date.now(), maxBackupAgeHours = DEFAULT_MAX_BACKUP_AGE_HOURS } = context

  if (!SHA40.test(String(deploySha ?? ''))) return reject('DEPLOY_SHA_INVALID')
  if (typeof rawText !== 'string' || rawText.trim().length === 0) return reject('ATTESTATION_EMPTY')

  let data
  try {
    data = JSON.parse(rawText)
  } catch {
    return reject('ATTESTATION_INVALID_JSON')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return reject('ATTESTATION_INVALID_SHAPE')

  if (data.schemaVersion !== SCHEMA_VERSION) return reject('SCHEMA_VERSION_UNSUPPORTED')
  if (typeof data.backupId !== 'string' || !SAFE_ID.test(data.backupId)) return reject('BACKUP_ID_INVALID')
  if (!ALLOWED_BACKUP_TYPES.includes(data.backupType)) return reject('BACKUP_TYPE_UNSUPPORTED')
  if (typeof data.verifiedBy !== 'string' || !SAFE_NAME.test(data.verifiedBy)) return reject('VERIFIED_BY_INVALID')
  if (data.targetReleaseSha !== deploySha) return reject('TARGET_RELEASE_SHA_MISMATCH')
  if (data.pitrAvailable !== true) return reject('PITR_NOT_CONFIRMED')
  if (!Number.isSafeInteger(data.pitrRetentionDays) || data.pitrRetentionDays < 1) {
    return reject('PITR_RETENTION_INVALID')
  }
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
      schemaVersion: data.schemaVersion,
      backupId: data.backupId,
      backupType: data.backupType,
      backupCompletedAt: data.backupCompletedAt,
      pitrAvailable: data.pitrAvailable,
      pitrRetentionDays: data.pitrRetentionDays,
      restoreDrillVerified: data.restoreDrillVerified,
      restoreDrillAt: data.restoreDrillAt,
      verifiedBy: data.verifiedBy,
      targetReleaseSha: data.targetReleaseSha,
      expiresAt: data.expiresAt,
      backupAgeMinutes: Math.floor((now - backupCompletedAt) / 60_000),
    },
  }
}

/** Read-only host-side checks: regular file, not a symlink, not group/world writable. */
export function readAttestationFile(filePath) {
  const stats = lstatSync(filePath)
  if (!stats.isFile()) throw new Error('ATTESTATION_NOT_A_REGULAR_FILE')
  // POSIX mode bits are meaningless on NTFS (Windows ACLs), so the strict
  // group/world-writable and owner checks apply on the POSIX production host
  // only. They are never relaxed there.
  if (process.platform !== 'win32') {
    if ((stats.mode & 0o022) !== 0) throw new Error('ATTESTATION_UNSAFE_PERMISSIONS')
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) {
      throw new Error('ATTESTATION_UNEXPECTED_OWNER')
    }
  }
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

function verifyOnHost(options) {
  const attestationPath = String(options.attestation ?? '')
  const deploySha = String(options['deploy-sha'] ?? '')
  const nowOption = options.now
  const maxBackupAgeHours = Number(options['max-backup-age-hours'] ?? DEFAULT_MAX_BACKUP_AGE_HOURS)

  // Production is POSIX. Windows-style absolute paths are accepted only so the
  // gate can be smoke-tested on a developer machine; relative paths and any
  // traversal component are always refused.
  const isPosixAbsolute = attestationPath.startsWith('/')
  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(attestationPath)
  if ((!isPosixAbsolute && !isWindowsAbsolute) || attestationPath.includes('..')) {
    console.log('BACKUP_GATE=REJECTED')
    console.log('BACKUP_GATE_REASON=ATTESTATION_PATH_INVALID')
    console.log('BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT')
    return 1
  }

  let rawText
  try {
    rawText = readAttestationFile(attestationPath)
  } catch (error) {
    console.log('BACKUP_GATE=REJECTED')
    console.log(`BACKUP_GATE_REASON=${error.message ?? error}`)
    console.log('BACKUP_PITR_VERIFIED=NO')
    console.log('RESTORE_DRILL_VERIFIED=NO')
    console.log('BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT')
    return 1
  }

  const parsedNow = typeof nowOption === 'string' ? Date.parse(nowOption) : Date.now()
  const result = verifyBackupAttestation(rawText, {
    deploySha,
    now: Number.isFinite(parsedNow) ? parsedNow : Date.now(),
    maxBackupAgeHours: Number.isFinite(maxBackupAgeHours) && maxBackupAgeHours > 0
      ? maxBackupAgeHours
      : DEFAULT_MAX_BACKUP_AGE_HOURS,
  })

  if (!result.ok) {
    console.log('BACKUP_GATE=REJECTED')
    console.log(`BACKUP_GATE_REASON=${result.reason}`)
    console.log('BACKUP_PITR_VERIFIED=NO')
    console.log('RESTORE_DRILL_VERIFIED=NO')
    console.log('BACKUP_GATE_ACTION=REFUSING_MIGRATION_AND_DEPLOYMENT')
    return 1
  }

  const evidence = result.evidence
  console.log('BACKUP_GATE=VERIFIED')
  console.log(`BACKUP_GATE_SCHEMA_VERSION=${evidence.schemaVersion}`)
  console.log(`BACKUP_ID=${evidence.backupId}`)
  console.log(`BACKUP_TYPE=${evidence.backupType}`)
  console.log(`BACKUP_COMPLETED_AT=${evidence.backupCompletedAt}`)
  console.log(`BACKUP_AGE_MINUTES=${evidence.backupAgeMinutes}`)
  console.log('BACKUP_PITR_VERIFIED=YES')
  console.log(`BACKUP_PITR_RETENTION_DAYS=${evidence.pitrRetentionDays}`)
  console.log('RESTORE_DRILL_VERIFIED=YES')
  console.log(`RESTORE_DRILL_AT=${evidence.restoreDrillAt}`)
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
