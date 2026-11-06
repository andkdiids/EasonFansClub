export const SCHEMA_VERSION: number
export const WAIVER_SCHEMA_VERSION: number
export const RISK_ACCEPTANCE_SCHEMA_VERSION: number
export const DEFAULT_MAX_BACKUP_AGE_HOURS: number
export const MAX_ATTESTATION_TTL_HOURS: number
export const MAX_WAIVER_AGE_HOURS: number
export const ALLOWED_BACKUP_TYPES: string[]
export const WAIVER_ALLOWED_BACKUP_TYPES: string[]
export const WAIVER_MODE_NONE: string
export const WAIVER_MODE_APPROVED: string
export const SUPPORTED_WAIVER_MODES: string[]
export const RISK_ACCEPTANCE_MODE_NONE: string
export const RISK_ACCEPTANCE_MODE_APPROVED: string
export const SUPPORTED_RISK_ACCEPTANCE_MODES: string[]

export interface RestoreDrillWaiver {
  approvedBy: string
  approvedAt: string
  riskStatement: string
  releaseId: string
}

export interface RiskAcceptance {
  approvedBy: string
  approvedAt: string
  riskStatement: string
  releaseId: string
  noIndependentBackupVerification: boolean
  noRestoreDrill: boolean
}

export interface BackupEvidence {
  schemaVersion: number
  backupVerified?: boolean
  pitrVerified?: boolean
  restoreDrillVerified: boolean
  restoreDrillWaived: boolean
  riskAccepted?: boolean
  backupId?: string | null
  backupType?: string | null
  backupCompletedAt?: string | null
  pitrAvailable?: boolean | null
  pitrRetentionDays?: number | null
  restoreDrillAt?: string | null
  waiver?: RestoreDrillWaiver | null
  riskAcceptance?: RiskAcceptance | null
  verifiedBy?: string | null
  targetReleaseSha: string
  expiresAt: string
  backupAgeMinutes?: number | null
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
  allowRiskAcceptance?: boolean
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
