export const RC11_BASELINE: Readonly<{
  applicationId: string
  versionCode: number
  versionName: string
  size: number
  sha256: string
  signerSha256: string
}>

export const CODE30_BASELINE: Readonly<{
  applicationId: string
  versionCode: number
  versionName: string
  size: number
  sha256: string
  signerSha256: string
}>

export const EXPECTED_OIDC_SUBJECT: string

export function validateCode30VersionApi(body: Record<string, unknown>): Record<string, unknown>
export function validateIngressManifest(manifest: Record<string, unknown>, context?: Record<string, string>): Record<string, unknown>
export function createVersionedObjectKey(kind: 'code30-backup' | 'rc11', context?: { date?: Date; runId?: string; runAttempt?: string }): string
export function validateVersionedObjectKey(key: string, kind: 'code30-backup' | 'rc11', context?: { runId?: string; runAttempt?: string }): string
export function validateCosConfig(env?: Record<string, string | undefined>): Record<string, string | undefined>
export function validateOidcClaims(claims: Record<string, unknown>, expected: { audience: string; expectedSubject: string; workflowRef: string }): true
export function validateObjectMetadata(result: { statusCode?: number; headers?: Record<string, unknown> }, expected: { size: number; sha256: string }): true
export function assertObjectAbsent(cos: { headObject(input: { Bucket: string; Region: string; Key: string }): Promise<{ statusCode?: number }> }, bucket: string, region: string, key: string): Promise<void>
export function hashFile(filePath: string): Promise<{ size: number; sha256: string }>
export function publishCode30Backup(input?: { env?: Record<string, string>; fetchImpl?: typeof fetch; date?: Date }): Promise<{ key: string; baselinePath: string }>
export function publishRc11Artifact(input?: { env?: Record<string, string>; fetchImpl?: typeof fetch; date?: Date }): Promise<{ key: string; cdnUrl: string; backupKey: string }>
