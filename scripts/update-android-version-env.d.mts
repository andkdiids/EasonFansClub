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

export function configureAndroidVersionEnv(input: {
  appDir: string
  expectedProductionSha: string
  metadata: AndroidReleaseMetadata
  expectedCurrentMetadata?: AndroidVersionApiBaseline
  now?: Date
}): { backupPath: string; changedKeys: string[]; envSha256: string }

export function restoreAndroidVersionEnv(input: {
  appDir: string
  expectedProductionSha: string
  backupName: string
  code30BackupObjectKey: string
  now?: Date
}): { backupPath: string; changedKeys: string[]; envSha256: string }
