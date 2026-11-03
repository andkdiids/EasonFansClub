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
export const CODE31_BASELINE: typeof RC11_BASELINE
export const CODE30_ROLLBACK_OBJECT_KEY: string
export const CODE31_ROLLBACK_OBJECT_KEY: string
export const RC12_BASELINE: Readonly<{
  applicationId: string
  versionCode: number
  versionName: string
  size: number
  sha256: string
  signerSha256: string
}>

export const EXPECTED_OIDC_SUBJECT: string
export const EXPECTED_OIDC_WORKFLOW_REF: string
export const APK_DOWNLOAD_TIMEOUT_MS: number
export const COS_REQUEST_TIMEOUT_MS: number
export function captureVersionApiBaseline(input?: { candidate?: 'rc11' | 'rc12'; env?: Record<string, string>; fetchImpl?: typeof fetch }): Promise<{ body: Record<string, unknown>; baselinePath: string; rollbackSource: { key: string; size: number; code: 30 | 31 } }>

export function validateCode30VersionApi(body: Record<string, unknown>): Record<string, unknown>
export function validateCode31VersionApi(body: Record<string, unknown>): Record<string, unknown>
export function validateIngressManifest(manifest: Record<string, unknown>, context?: Record<string, string> & { candidate?: 'rc11' | 'rc12' }): Record<string, unknown>
export function createVersionedObjectKey(kind: 'rc11' | 'rc12', context?: { date?: Date; runId?: string; runAttempt?: string }): string
export function validateVersionedObjectKey(key: string, kind: 'rc11' | 'rc12', context?: { runId?: string; runAttempt?: string }): string
export function validateCosConfig(env?: Record<string, string | undefined>): Record<string, string | undefined>
export function validateOidcClaims(claims: Record<string, unknown>, expected: { audience: string; expectedSubject: string; workflowRef: string }): true
export function validateObjectMetadata(result: { statusCode?: number; headers?: Record<string, unknown> }, expected: { size: number; sha256: string }): true
export function assertObjectAbsent(cos: { headObject(input: { Bucket: string; Region: string; Key: string }): Promise<{ statusCode?: number }> }, bucket: string, region: string, key: string): Promise<void>
export function hashFile(filePath: string): Promise<{ size: number; sha256: string }>
export function createCosClient(credentials: { SecretId: string; SecretKey: string; SecurityToken: string }, COS?: new (options: Record<string, unknown>) => unknown): unknown
export function downloadToFile(url: string, filePath: string, options: { fetchImpl?: typeof fetch; expectedSize: number; expectedSha256: string; stage?: string; logImpl?: (line: string) => void }): Promise<{ size: number; sha256: string; url: string }>
export function publishRc11Artifact(input?: { env?: Record<string, string>; fetchImpl?: typeof fetch; date?: Date }): Promise<{ key: string; cdnUrl: string }>
export function publishRc12Artifact(input?: { env?: Record<string, string>; fetchImpl?: typeof fetch; date?: Date }): Promise<{ key: string; cdnUrl: string }>

export function verifyOidcSts(input?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<true>
