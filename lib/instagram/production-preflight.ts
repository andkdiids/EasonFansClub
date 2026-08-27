import { getAnywhereDoorConfig, type AnywhereDoorStorageMode } from '@/lib/anywhere-door/config'
import { MockInstagramMediaLocalizer, SafeExternalInstagramMediaLocalizer, type InstagramMediaLocalizer } from '@/lib/instagram/media'
import { prisma } from '@/lib/prisma'

export const REQUIRED_ANYWHERE_DOOR_MODELS = ['socialPost', 'socialPostMedia', 'socialPostLike', 'socialPostComment', 'socialSyncLog', 'socialSyncState'] as const

type Environment = Record<string, string | undefined>

function configured(env: Environment, ...names: string[]) {
  return names.some((name) => Boolean(env[name]?.trim()))
}

export type AnywhereDoorProductionPreflight = {
  ok: boolean
  issues: string[]
  checks: {
    featureFlags: { enabled: boolean; syncEnabled: boolean; notificationEnabled: boolean }
    provider: string | null
    apifyTokenConfigured: boolean
    cosConfigured: boolean
    storageMode: AnywhereDoorStorageMode | null
    modelsPresent: boolean
    workerConfigured: boolean
    mockLocalizerRejected: boolean
  }
}

export function runAnywhereDoorProductionPreflight(env: Environment = process.env, options: { localizer?: InstagramMediaLocalizer; modelsPresent?: boolean; workerConfigured?: boolean } = {}): AnywhereDoorProductionPreflight {
  const config = getAnywhereDoorConfig(env)
  const issues: string[] = []
  const production = env.NODE_ENV === 'production'
  const apifyTokenConfigured = configured(env, 'APIFY_API_TOKEN')
  const cosConfigured = configured(env, 'TENCENT_COS_SECRET_ID', 'COS_SECRET_ID')
    && configured(env, 'TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY')
    && configured(env, 'TENCENT_COS_BUCKET', 'COS_BUCKET')
    && configured(env, 'TENCENT_COS_REGION', 'COS_REGION')
  const modelsPresent = options.modelsPresent ?? REQUIRED_ANYWHERE_DOOR_MODELS.every((model) => model in prisma)
  const workerConfigured = options.workerConfigured ?? true
  const mockLocalizerRejected = !production || !(options.localizer instanceof MockInstagramMediaLocalizer)
  const productionLocalizerSafe = !production || !options.localizer || options.localizer instanceof SafeExternalInstagramMediaLocalizer

  if (production && config.provider !== 'apify') issues.push('PROVIDER_MUST_BE_APIFY')
  if (production && config.target !== 'mreasonchan') issues.push('TARGET_MUST_BE_MREASONCHAN')
  if (production && !apifyTokenConfigured) issues.push('APIFY_TOKEN_NOT_CONFIGURED')
  if (production && !cosConfigured) issues.push('COS_NOT_CONFIGURED')
  if (config.storageMode === null) issues.push('INVALID_STORAGE_MODE')
  if (production && config.storageMode !== 'production') issues.push('PRODUCTION_STORAGE_MODE_REQUIRED')
  if (!modelsPresent) issues.push('DATABASE_MODELS_UNAVAILABLE')
  if (!workerConfigured) issues.push('WORKER_NOT_CONFIGURED')
  if (!mockLocalizerRejected) issues.push('UNSAFE_MEDIA_LOCALIZER')
  if (!productionLocalizerSafe) issues.push('UNSAFE_MEDIA_LOCALIZER')

  return {
    ok: issues.length === 0,
    issues,
    checks: {
      featureFlags: { enabled: config.enabled, syncEnabled: config.syncEnabled, notificationEnabled: config.notificationEnabled },
      provider: config.provider,
      apifyTokenConfigured,
      cosConfigured,
      storageMode: config.storageMode,
      modelsPresent,
      workerConfigured,
      mockLocalizerRejected: mockLocalizerRejected && productionLocalizerSafe,
    },
  }
}
