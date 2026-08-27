import { InstagramProviderError, normalizeInstagramUsername } from '@/lib/instagram/types'

export type AnywhereDoorStorageMode = 'poc' | 'production'

export const ANYWHERE_DOOR_TARGET = 'mreasonchan'
export const ANYWHERE_DOOR_PROVIDER = 'apify'
export const ANYWHERE_DOOR_SYNC_LOCK_KEY = `anywhere-door-instagram-sync:${ANYWHERE_DOOR_TARGET}`
export const DEFAULT_SYNC_NORMAL_INTERVAL_MINUTES = 15
export const DEFAULT_SYNC_IDLE_INTERVAL_MINUTES = 30
export const DEFAULT_PROVIDER_RUN_COOLDOWN_MINUTES = 5
export const DEFAULT_PROVIDER_RUNS_PER_DAY = 96

type Environment = Record<string, string | undefined>

function envValue(env: Environment, key: string) {
  const value = env[key]
  return typeof value === 'string' ? value.trim() : ''
}

function envBoolean(env: Environment, key: string) {
  return envValue(env, key).toLowerCase() === 'true'
}

function positiveInteger(env: Environment, key: string, fallback: number) {
  const value = Number(envValue(env, key))
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

export function parseAnywhereDoorStorageMode(value: string | undefined): AnywhereDoorStorageMode | null {
  const normalized = (value || 'poc').trim().toLowerCase()
  return normalized === 'poc' || normalized === 'production' ? normalized : null
}

export function getAnywhereDoorStorageMode(env: Environment = process.env): AnywhereDoorStorageMode | null {
  return parseAnywhereDoorStorageMode(envValue(env, 'ANYWHERE_DOOR_STORAGE_MODE') || 'poc')
}

export function assertAnywhereDoorStorageMode(env: Environment = process.env): AnywhereDoorStorageMode {
  const raw = envValue(env, 'ANYWHERE_DOOR_STORAGE_MODE') || 'poc'
  const mode = parseAnywhereDoorStorageMode(raw)
  if (!mode) throw new InstagramProviderError('CONFIG_ERROR', `未知的随意门存储模式: ${raw}`)
  return mode
}

export type AnywhereDoorConfig = {
  enabled: boolean
  syncEnabled: boolean
  notificationEnabled: boolean
  storageMode: AnywhereDoorStorageMode | null
  storageModeError: boolean
  provider: string | null
  target: string
  normalIntervalMinutes: number
  idleIntervalMinutes: number
  providerRunCooldownMinutes: number
  maxProviderRunsPerDay: number
}

export function getAnywhereDoorConfig(env: Environment = process.env): AnywhereDoorConfig {
  const rawStorageMode = envValue(env, 'ANYWHERE_DOOR_STORAGE_MODE') || 'poc'
  const storageMode = parseAnywhereDoorStorageMode(rawStorageMode)
  return {
    enabled: envBoolean(env, 'ANYWHERE_DOOR_ENABLED'),
    syncEnabled: envBoolean(env, 'ANYWHERE_DOOR_SYNC_ENABLED'),
    notificationEnabled: envBoolean(env, 'ANYWHERE_DOOR_NOTIFICATION_ENABLED'),
    storageMode,
    storageModeError: storageMode === null,
    provider: envValue(env, 'IG_PROVIDER').toLowerCase() || null,
    target: envValue(env, 'IG_TARGET_USERNAME') || ANYWHERE_DOOR_TARGET,
    normalIntervalMinutes: positiveInteger(env, 'IG_SYNC_NORMAL_INTERVAL_MINUTES', DEFAULT_SYNC_NORMAL_INTERVAL_MINUTES),
    idleIntervalMinutes: positiveInteger(env, 'IG_SYNC_IDLE_INTERVAL_MINUTES', DEFAULT_SYNC_IDLE_INTERVAL_MINUTES),
    providerRunCooldownMinutes: positiveInteger(env, 'ANYWHERE_DOOR_PROVIDER_RUN_COOLDOWN_MINUTES', DEFAULT_PROVIDER_RUN_COOLDOWN_MINUTES),
    maxProviderRunsPerDay: positiveInteger(env, 'ANYWHERE_DOOR_MAX_PROVIDER_RUNS_PER_DAY', DEFAULT_PROVIDER_RUNS_PER_DAY),
  }
}

export function isAnywhereDoorEnabled(env: Environment = process.env) {
  return envBoolean(env, 'ANYWHERE_DOOR_ENABLED')
}

export function isAnywhereDoorSyncEnabled(env: Environment = process.env) {
  return envBoolean(env, 'ANYWHERE_DOOR_SYNC_ENABLED')
}

export function isAnywhereDoorNotificationEnabled(env: Environment = process.env) {
  return envBoolean(env, 'ANYWHERE_DOOR_NOTIFICATION_ENABLED')
}

export function buildInstagramStoragePrefix(username: string, mode: AnywhereDoorStorageMode) {
  const normalized = normalizeInstagramUsername(username)
  return mode === 'production'
    ? `social/instagram/${normalized}`
    : `social/instagram/${normalized}/poc`
}

export type InstagramMediaStorageKeyInput = {
  username: string
  mode: AnywhereDoorStorageMode
  externalId: string
  kind: 'image' | 'video' | 'thumbnail'
  sortOrder: number
}

export function buildInstagramMediaStorageKey(input: InstagramMediaStorageKeyInput) {
  if (!/^[a-zA-Z0-9._:-]{1,191}$/.test(input.externalId)) {
    throw new InstagramProviderError('CONFIG_ERROR', 'Instagram externalId 不适合作为存储路径')
  }
  if (!Number.isSafeInteger(input.sortOrder) || input.sortOrder < 0) {
    throw new InstagramProviderError('CONFIG_ERROR', 'Instagram 媒体顺序无效')
  }
  const ordinal = String(input.sortOrder + 1).padStart(2, '0')
  const filename = input.kind === 'video' ? `video-${ordinal}.mp4` : input.kind === 'thumbnail' ? `thumb-${ordinal}.webp` : `image-${ordinal}.webp`
  return `${buildInstagramStoragePrefix(input.username, input.mode)}/${input.externalId}/${filename}`
}
