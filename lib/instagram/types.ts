export const INSTAGRAM_PROVIDER_NAMES = ['brightdata', 'apify', 'browser', 'mock'] as const
export type InstagramProviderName = typeof INSTAGRAM_PROVIDER_NAMES[number]

export const INSTAGRAM_MEDIA_TYPES = ['IMAGE', 'VIDEO'] as const
export type InstagramMediaType = typeof INSTAGRAM_MEDIA_TYPES[number]

export const INSTAGRAM_POST_TYPES = ['IMAGE', 'VIDEO', 'CAROUSEL', 'REEL'] as const
export type InstagramPostType = typeof INSTAGRAM_POST_TYPES[number]

export type InstagramMedia = {
  type: InstagramMediaType
  sourceUrl: string
  thumbnailUrl: string | null
  width: number | null
  height: number | null
  duration: number | null
  sortOrder: number
}

export type InstagramPost = {
  externalId: string
  shortcode: string | null
  username: string
  caption: string | null
  publishedAt: Date
  permalink: string | null
  mediaType: InstagramPostType
  media: InstagramMedia[]
}

export type InstagramProviderOptions = {
  /** The provider must receive this explicitly; no global proxy env is read. */
  proxyUrl?: string | null
  enabled?: boolean
}

export type InstagramProviderTrace = {
  actor: string | null
  runId: string | null
  datasetId: string | null
  runStatus: string | null
  runStartedAt: Date | null
  runFinishedAt: Date | null
  usageTotalUsd: number | null
  billableResults: number | null
}

export interface InstagramProvider {
  readonly name: InstagramProviderName
  readonly proxyUrl: string | null
  getLatestPosts(username: string, limit: number): Promise<InstagramPost[]>
  getTrace?(): InstagramProviderTrace | null
}

export type InstagramProviderErrorCode =
  | 'CONFIG_ERROR'
  | 'LOGIN_REQUIRED'
  | 'CHALLENGE_REQUIRED'
  | 'RATE_LIMITED'
  | 'PROVIDER_AUTH_ERROR'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_RUN_FAILED'
  | 'PROVIDER_EMPTY_RESULT'
  | 'PROVIDER_CONTRACT_FAILED'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNSTABLE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_DISABLED_IN_PHASE_3'
  | 'UNSAFE_MEDIA_LOCALIZER'
  | 'INVALID_DATA'

export type InstagramProviderNetworkDetails = {
  name: string | null
  code: string | null
  causeCode: string | null
  causeErrno: string | number | null
  causeSyscall: string | null
  causeHostname: string | null
}

export class InstagramProviderError extends Error {
  readonly code: InstagramProviderErrorCode
  readonly retryAfterSeconds?: number
  readonly network?: InstagramProviderNetworkDetails

  constructor(code: InstagramProviderErrorCode, message: string, options?: { retryAfterSeconds?: number; cause?: unknown; network?: InstagramProviderNetworkDetails }) {
    super(message, options)
    this.name = 'InstagramProviderError'
    this.code = code
    this.retryAfterSeconds = options?.retryAfterSeconds
    this.network = options?.network
  }
}

export function normalizeProviderLimit(limit: number) {
  if (!Number.isFinite(limit)) return 3
  return Math.min(50, Math.max(1, Math.floor(limit)))
}

export function normalizeInstagramUsername(username: string) {
  const normalized = username.trim().replace(/^@+/, '').toLowerCase()
  if (!/^[a-z0-9._]{1,30}$/.test(normalized)) {
    throw new InstagramProviderError('CONFIG_ERROR', 'Instagram username 格式无效')
  }
  return normalized
}
