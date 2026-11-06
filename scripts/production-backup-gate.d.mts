export const SCHEMA_VERSION: number
export const DEFAULT_MAX_BACKUP_AGE_HOURS: number
export const MAX_ATTESTATION_TTL_HOURS: number
export const ALLOWED_BACKUP_TYPES: string[]

export interface BackupEvidence {
  schemaVersion: number
  backupId: string
  backupType: string
  backupCompletedAt: string
  pitrAvailable: boolean
  pitrRetentionDays: number
  restoreDrillVerified: boolean
  restoreDrillAt: string
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

export function verifyBackupAttestation(
  rawText: unknown,
  context: { deploySha: string; now?: number; maxBackupAgeHours?: number },
): BackupGateResult

export function readAttestationFile(filePath: string): string
