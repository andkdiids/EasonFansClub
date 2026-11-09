export interface Rc13ReleasePin {
  applicationId: 'fans.ecfc.app'
  versionCode: 33
  versionName: '1.0.0-beta.21'
  sha256: string
  size: number
  signerSha256: string
  sourceFile: string
  sourcePath: string
  releaseNotes: string[]
}

export interface Code32VersionApiResponse {
  platform: 'android'
  versionName: '1.0.0-beta.21'
  versionCode: 32
  minimumVersionCode: 19
  forceUpdate: false
  apkSha256: string
  size: number
  downloadUrl: 'https://ecfc.fans/api/app/download/android'
  releaseNotes: string[]
  publishedAt: string
}

export const CODE32_ROLLBACK_OBJECT_KEY: string
export const CODE32_BASELINE: Readonly<{
  applicationId: 'fans.ecfc.app'
  versionCode: 32
  versionName: '1.0.0-beta.21'
  sha256: string
  size: number
  signerSha256: string
}>

export function validateRc13Pin(pin: Rc13ReleasePin): Rc13ReleasePin
export function loadRc13Pin(): Rc13ReleasePin
export function validateCode32VersionApi(body: Code32VersionApiResponse): Code32VersionApiResponse
