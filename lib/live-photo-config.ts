export type LivePhotoConfig = {
  enabled: boolean
  maxDurationSeconds: number
  maxUploadBytes: number
  maxVideoEdge: number
  maxFps: number
  quality: number
  transcodeConcurrency: number
  keepAudio: boolean
  maxAssetBytes: number
  transcodeTimeoutMs: number
}

export const DEFAULT_LIVE_PHOTO_CONFIG: LivePhotoConfig = {
  enabled: true,
  maxDurationSeconds: 5,
  maxUploadBytes: 30 * 1024 * 1024,
  maxVideoEdge: 1080,
  maxFps: 30,
  quality: 26,
  transcodeConcurrency: 1,
  keepAudio: true,
  maxAssetBytes: 8 * 1024 * 1024,
  transcodeTimeoutMs: 120_000,
}

export const LIVE_PHOTO_CONFIG_KEY = 'media.livePhoto'

function intInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback
}

/** Pure normalizer so tests and the admin API share one validation path. */
export function normalizeLivePhotoConfig(raw: unknown): LivePhotoConfig {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_LIVE_PHOTO_CONFIG.enabled,
    maxDurationSeconds: intInRange(source.maxDurationSeconds, DEFAULT_LIVE_PHOTO_CONFIG.maxDurationSeconds, 1, 15),
    maxUploadBytes: intInRange(source.maxUploadBytes, DEFAULT_LIVE_PHOTO_CONFIG.maxUploadBytes, 1024 * 1024, 100 * 1024 * 1024),
    maxVideoEdge: intInRange(source.maxVideoEdge, DEFAULT_LIVE_PHOTO_CONFIG.maxVideoEdge, 360, 2160),
    maxFps: intInRange(source.maxFps, DEFAULT_LIVE_PHOTO_CONFIG.maxFps, 15, 60),
    quality: intInRange(source.quality, DEFAULT_LIVE_PHOTO_CONFIG.quality, 18, 40),
    transcodeConcurrency: intInRange(source.transcodeConcurrency, DEFAULT_LIVE_PHOTO_CONFIG.transcodeConcurrency, 1, 2),
    keepAudio: typeof source.keepAudio === 'boolean' ? source.keepAudio : DEFAULT_LIVE_PHOTO_CONFIG.keepAudio,
    maxAssetBytes: intInRange(source.maxAssetBytes, DEFAULT_LIVE_PHOTO_CONFIG.maxAssetBytes, 1024 * 1024, 30 * 1024 * 1024),
    transcodeTimeoutMs: intInRange(source.transcodeTimeoutMs, DEFAULT_LIVE_PHOTO_CONFIG.transcodeTimeoutMs, 30_000, 300_000),
  }
}

export function publicLivePhotoConfig(config: LivePhotoConfig) {
  return {
    enabled: config.enabled,
    maxDurationSeconds: config.maxDurationSeconds,
    maxUploadBytes: config.maxUploadBytes,
    maxVideoEdge: config.maxVideoEdge,
    maxFps: config.maxFps,
    maxAssetBytes: config.maxAssetBytes,
    keepAudio: config.keepAudio,
  }
}
