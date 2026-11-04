export type AndroidReleaseMetadata = {
  ANDROID_VERSION_NAME: string
  ANDROID_VERSION_CODE: number
  ANDROID_MINIMUM_VERSION_CODE: number
  ANDROID_FORCE_UPDATE: boolean
  ANDROID_APK_COS_KEY: string
  ANDROID_APK_SHA256: string
  ANDROID_APK_SIZE: number
  ANDROID_RELEASE_NOTES: string
  ANDROID_PUBLISHED_AT: string
}

export type AndroidVersionApiBaseline = {
  ANDROID_VERSION_NAME: string
  ANDROID_VERSION_CODE: number
  ANDROID_MINIMUM_VERSION_CODE: number
  ANDROID_FORCE_UPDATE: boolean
  ANDROID_APK_SHA256: string
  ANDROID_APK_SIZE: number
  ANDROID_RELEASE_NOTES: string | string[]
  ANDROID_PUBLISHED_AT: string
}

export type AndroidArtifactPin = { sha256: string; size: number }

export function configureAndroidVersionEnv(input: {
  appDir: string
  expectedProductionSha: string
  metadata: AndroidReleaseMetadata
  expectedCurrentMetadata?: AndroidVersionApiBaseline
  rc13Pin?: AndroidArtifactPin
  now?: Date
}): { backupPath: string; changedKeys: string[]; envSha256: string }

export type AndroidVersionRollbackInput = {
  appDir: string
  expectedProductionSha: string
  backupName: string
  now?: Date
} & (
  { targetVersionCode: 30; code30BackupObjectKey: string }
  | { targetVersionCode: 31; code30BackupObjectKey?: never }
  | { targetVersionCode: 32; code30BackupObjectKey?: never; expectedCurrentMetadata: AndroidVersionApiBaseline; rc13Pin: AndroidArtifactPin }
)

export function restoreAndroidVersionEnv(input: AndroidVersionRollbackInput): { backupPath: string; changedKeys: string[]; envSha256: string }
