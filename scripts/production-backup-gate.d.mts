export const SCHEMA_VERSION: number
export const WAIVER_SCHEMA_VERSION: number
export const DEFAULT_MAX_BACKUP_AGE_HOURS: number
export const MAX_ATTESTATION_TTL_HOURS: number
export const MAX_WAIVER_AGE_HOURS: number
export const ALLOWED_BACKUP_TYPES: string[]
export const WAIVER_ALLOWED_BACKUP_TYPES: string[]
export const WAIVER_MODE_NONE: string
export const WAIVER_MODE_APPROVED: string
export const SUPPORTED_WAIVER_MODES: string[]

export interface RestoreDrillWaiver {
  approvedBy: string
  approvedAt: string
  riskStatement: string
  releaseId: string
}

export interface BackupEvidence {
  schemaVersion: number
  backupId: string
  backupType: string
  backupCompletedAt: string
  pitrAvailable: boolean
  pitrRetentionDays: number
  restoreDrillVerified: boolean
  restoreDrillWaived: boolean
  restoreDrillAt: string | null
  waiver: RestoreDrillWaiver | null
  verifiedBy: string
  targetReleaseSha: string
  expiresAt: string
  backupAgeMinutes: number
}

export interface BackupGateResult {
  ok: boolean
  reason: string | null
  evidence: BackupEvidence | null
}

export interface BackupGateContext {
  deploySha: string
  now?: number
  maxBackupAgeHours?: number
  allowRestoreDrillWaiver?: boolean
}

export function verifyBackupAttestation(rawText: unknown, context: BackupGateContext): BackupGateResult

export interface AttestationStat {
  isFile(): boolean
  isSymbolicLink?(): boolean
  mode: number
  uid: number
}

export function assertAttestationFileStat(
  stats: AttestationStat,
  options?: { platform?: string; uid?: number },
): true

export function readAttestationFile(filePath: string): string
