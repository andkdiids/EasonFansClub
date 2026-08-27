import {
  dedupeAndSortInstagramPosts,
  normalizeInstagramPost,
} from '@/lib/instagram/normalize'
import {
  InstagramProviderError,
  normalizeInstagramUsername,
  normalizeProviderLimit,
  type InstagramPost,
  type InstagramProvider,
  type InstagramProviderDiagnostics,
  type InstagramProviderOptions,
  type InstagramProviderTrace,
} from '@/lib/instagram/types'
import { ProxyAgent } from 'undici'

export const APIFY_INSTAGRAM_SCRAPER_ACTOR = 'apify~instagram-scraper'
export const APIFY_API_BASE_URL = 'https://api.apify.com/v2'
export const APIFY_REQUEST_TIMEOUT_MS = 20_000
export const APIFY_RUN_TIMEOUT_MS = 300_000
export const APIFY_RUN_POLL_INTERVAL_MS = 5_000
export const APIFY_COST_SETTLE_DELAY_MS = 10_000
export const APIFY_DATASET_INSPECTION_LIMIT = 50

type UnknownRecord = Record<string, unknown>
type FetchImplementation = typeof fetch

export type InstagramOwnerResolutionSource =
  | 'ownerUsername'
  | 'owner.username'
  | 'username'
  | 'profileUsername'
  | 'inputUrl'
  | 'profileUrl'
  | 'url'

export type InstagramOwnerResolution = {
  username: string | null
  source: InstagramOwnerResolutionSource | null
}

export type InstagramTargetRelationship = 'DIRECT_OWNER' | 'COLLABORATOR' | 'FOREIGN' | 'UNVERIFIABLE'

export type ApifyProviderDiagnostics = InstagramProviderDiagnostics & {
  actor: typeof APIFY_INSTAGRAM_SCRAPER_ACTOR
  actorRuns: number
  apiRequests: number
  datasetItems: number
  postItems: number
  targetPosts: number
  foreignOwnerSkipped: number
  runStatus: string | null
  usageTotalUsd: number | null
  billableResults: number | null
  pinnedDetected: boolean
  duplicateExternalIds: number
  rawItemKeys: string[][]
  rawItemTypes: Array<string | null>
  childPostsCounts: number[]
}

export type ApifyInstagramProviderOptions = InstagramProviderOptions & {
  fetchImpl?: FetchImplementation
  sleep?: (milliseconds: number) => Promise<void>
  runTimeoutMs?: number
  pollIntervalMs?: number
  costSettleDelayMs?: number
}

type ApifyRun = {
  id: string
  status: string
  defaultDatasetId: string | null
  startedAt: Date | null
  finishedAt: Date | null
  usageTotalUsd: number | null
  billableResults: number | null
  inputTarget: string | null
}

const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMING-OUT', 'TIMED-OUT', 'ABORTING', 'ABORTED'])

function normalizeProxyUrl(value: string | null | undefined) {
  const candidate = value?.trim()
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
    return parsed.toString()
  } catch {
    throw new InstagramProviderError('CONFIG_ERROR', 'APIFY_PROXY_URL 格式无效')
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null
}

function stringValue(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function normalizedUsernameCandidate(value: unknown) {
  const candidate = stringValue(value)
  if (!candidate) return null
  try {
    return normalizeInstagramUsername(candidate)
  } catch {
    return null
  }
}

function identifierValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function firstUrl(value: unknown): string | null {
  if (typeof value === 'string') return stringValue(value)
  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = firstUrl(entry)
      if (url) return url
    }
    return null
  }
  const item = asRecord(value)
  if (!item) return null
  for (const key of ['url', 'src', 'sourceUrl', 'displayUrl', 'display_url', 'videoUrl', 'video_url']) {
    const url = firstUrl(item[key])
    if (url) return url
  }
  return null
}

function mediaUrl(item: UnknownRecord, keys: readonly string[]) {
  for (const key of keys) {
    const url = firstUrl(item[key])
    if (url) return url
  }
  return null
}

function imageUrl(item: UnknownRecord) {
  return mediaUrl(item, [
    'displayUrl',
    'display_url',
    'thumbnailUrl',
    'thumbnail_url',
    'thumbnail',
    'imageUrl',
    'image_url',
    'images',
    'image',
  ])
}

function videoUrl(item: UnknownRecord) {
  return mediaUrl(item, ['videoUrl', 'video_url', 'videos', 'video'])
}

function dimensions(item: UnknownRecord) {
  const nested = asRecord(item.dimensions)
  return {
    width: numberValue(item.dimensionsWidth ?? item.width ?? nested?.width),
    height: numberValue(item.dimensionsHeight ?? item.height ?? nested?.height),
  }
}

function duration(item: UnknownRecord) {
  return numberValue(item.videoDuration ?? item.duration ?? item.durationSeconds)
}

function isVideoItem(item: UnknownRecord) {
  const rawType = stringValue(item.type)?.toLowerCase()
  return Boolean(videoUrl(item)) || rawType === 'video' || rawType === 'reel' || rawType === 'clips'
}

function isReelItem(item: UnknownRecord) {
  const productType = stringValue(item.productType)?.toLowerCase()
  const rawType = stringValue(item.type)?.toLowerCase()
  const inputUrl = stringValue(item.inputUrl)?.toLowerCase() || ''
  return productType === 'clips'
    || productType === 'reel'
    || productType === 'reels'
    || rawType === 'reel'
    || /\/reels?\//.test(inputUrl)
}

function isConcreteInstagramPermalink(value: string | null) {
  if (!value) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && (url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com'))
      && /^\/(?:p|reel|reels)\/[^/]+\/?$/.test(url.pathname)
      && !url.username
      && !url.password
  } catch {
    return false
  }
}

const NON_PROFILE_INSTAGRAM_PATHS = new Set([
  'about', 'accounts', 'api', 'ar', 'challenge', 'create', 'direct', 'directory',
  'emails', 'explore', 'graphql', 'legal', 'oauth', 'p', 'privacy', 'reel', 'reels',
  'recommendations', 'session', 'settings', 'stories', 'terms', 'tv', 'web',
])

function profileUsernameFromUrl(value: unknown) {
  const candidate = stringValue(value)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:'
      || (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com'))
      || url.username
      || url.password) return null
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 1) return null
    if (NON_PROFILE_INSTAGRAM_PATHS.has(segments[0]!.toLowerCase())) return null
    try {
      return normalizeInstagramUsername(segments[0] || '')
    } catch {
      return null
    }
  } catch {
    return null
  }
}

function profileUsernameFromInputValue(value: unknown) {
  if (typeof value === 'string') return profileUsernameFromUrl(value)
  return profileUsernameFromUrl(firstUrl(value))
}

/**
 * Resolves the post owner from actual Apify fields without ever defaulting to
 * the requested target. URL fallback is accepted only for a canonical
 * one-segment Instagram profile URL, never for a post URL or a mention.
 */
export function resolveInstagramOwnerUsername(value: unknown): InstagramOwnerResolution {
  const item = asRecord(value)
  if (!item) return { username: null, source: null }

  const directCandidates: Array<{ source: Extract<InstagramOwnerResolutionSource, 'ownerUsername' | 'owner.username' | 'username' | 'profileUsername'>; value: unknown }> = [
    { source: 'ownerUsername', value: item.ownerUsername },
    { source: 'owner.username', value: asRecord(item.owner)?.username },
    { source: 'username', value: item.username },
    { source: 'profileUsername', value: item.profileUsername },
  ]
  for (const candidate of directCandidates) {
    const username = normalizedUsernameCandidate(candidate.value)
    if (username) return { username, source: candidate.source }
  }

  const urlCandidates: Array<{ source: Extract<InstagramOwnerResolutionSource, 'inputUrl' | 'profileUrl' | 'url'>; value: unknown }> = [
    { source: 'inputUrl', value: item.inputUrl },
    { source: 'profileUrl', value: item.profileUrl },
    { source: 'url', value: item.url },
  ]
  for (const candidate of urlCandidates) {
    const username = profileUsernameFromInputValue(candidate.value)
    if (username) return { username, source: candidate.source }
  }

  return { username: null, source: null }
}

const COLLABORATION_FIELDS = ['coauthorProducers', 'coauthors', 'collaborators'] as const

function collaborationEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (!record) return value === undefined || value === null ? [] : [value]
  for (const key of ['users', 'items', 'data']) {
    if (Array.isArray(record[key])) return record[key]
  }
  return [value]
}

function collaborationUsername(value: unknown) {
  const direct = normalizedUsernameCandidate(value)
  if (direct) return direct
  const record = asRecord(value)
  if (!record) return null

  for (const key of ['username', 'userName', 'profileUsername', 'handle']) {
    const username = normalizedUsernameCandidate(record[key])
    if (username) return username
  }

  const nestedUser = asRecord(record.user)
  for (const key of ['username', 'userName', 'profileUsername', 'handle']) {
    const username = normalizedUsernameCandidate(nestedUser?.[key])
    if (username) return username
  }

  return profileUsernameFromInputValue(record.profileUrl)
    || profileUsernameFromInputValue(record.profile_url)
}

/**
 * Resolves only explicit collaboration/coauthor fields. Tags, mentions,
 * captions, and comments are intentionally excluded because they do not prove
 * that the target account is a coauthor of the post.
 */
export function resolveInstagramCollaborationUsernames(value: unknown) {
  const item = asRecord(value)
  if (!item) return []
  const usernames = new Set<string>()
  for (const field of COLLABORATION_FIELDS) {
    for (const entry of collaborationEntries(item[field])) {
      const username = collaborationUsername(entry)
      if (username) usernames.add(username)
    }
  }
  return [...usernames].sort()
}

/**
 * Classifies a Dataset item without treating a tagged/mentioned account as a
 * collaborator. Missing ownership remains unverifiable even if a malformed
 * collaboration field happens to contain the requested username.
 */
export function classifyInstagramTargetRelationship(value: unknown, target: string): InstagramTargetRelationship {
  const requestedTarget = normalizeInstagramUsername(target)
  const owner = resolveInstagramOwnerUsername(value).username
  if (!owner) return 'UNVERIFIABLE'
  if (owner === requestedTarget) return 'DIRECT_OWNER'
  return resolveInstagramCollaborationUsernames(value).includes(requestedTarget)
    ? 'COLLABORATOR'
    : 'FOREIGN'
}

function resolveApifyRunInputTarget(value: unknown) {
  const input = asRecord(value)
  if (!input) return null

  for (const key of ['directUrls', 'startUrls', 'profileUrls', 'profileUrl', 'inputUrl']) {
    const username = profileUsernameFromInputValue(input[key])
    if (username) return username
  }
  for (const key of ['username', 'targetUsername', 'usernames']) {
    const values = Array.isArray(input[key]) ? input[key] : [input[key]]
    const usernames = [...new Set(values.map(normalizedUsernameCandidate).filter((username): username is string => Boolean(username)))]
    const username = usernames.length === 1 ? usernames[0] : null
    if (username) return username
  }
  return null
}

function permalinkFor(item: UnknownRecord, shortcode: string) {
  const candidate = stringValue(item.permalink) || stringValue(item.url)
  if (isConcreteInstagramPermalink(candidate)) return candidate
  return `https://www.instagram.com/${isReelItem(item) ? 'reel' : 'p'}/${shortcode}/`
}

function timestampFor(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 100_000_000_000 ? value * 1000 : value
    const date = new Date(milliseconds)
    if (Number.isFinite(date.getTime())) return date
  }
  return value
}

function rawMedia(item: UnknownRecord, sortOrder: number) {
  const isVideo = isVideoItem(item)
  const sourceUrl = isVideo ? videoUrl(item) : imageUrl(item)
  if (!sourceUrl) {
    throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', `Apify media[${sortOrder}] 缺少媒体 URL`)
  }
  const size = dimensions(item)
  return {
    type: isVideo ? 'VIDEO' : 'IMAGE',
    sourceUrl,
    thumbnailUrl: isVideo ? imageUrl(item) : null,
    width: size.width,
    height: size.height,
    duration: isVideo ? duration(item) : null,
    sortOrder,
  }
}

/**
 * Maps one raw `apify/instagram-scraper` posts row to the shared provider
 * contract. The mapper intentionally only uses the post timestamp, never
 * `scrapedAt` or the Actor run time, for `publishedAt`.
 */
export function normalizeApifyInstagramItem(value: unknown): InstagramPost {
  const item = asRecord(value)
  if (!item) throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset item 不是对象')

  const externalId = identifierValue(item.id ?? item.externalId)
  const shortcode = identifierValue(item.shortCode ?? item.shortcode)
  const username = resolveInstagramOwnerUsername(item).username
  const publishedAt = timestampFor(item.timestamp ?? item.takenAtIso ?? item.takenAt)
  if (!externalId || !shortcode || !username || publishedAt === undefined || publishedAt === null) {
    throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset item 缺少统一 contract 字段')
  }

  const childPosts = Array.isArray(item.childPosts) ? item.childPosts : []
  const media = childPosts.length
    ? childPosts.map((child, index) => {
      const childRecord = asRecord(child)
      if (!childRecord) throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', `Apify childPosts[${index}] 不是对象`)
      return rawMedia(childRecord, index)
    })
    : [rawMedia(item, 0)]

  const mediaType = childPosts.length
    ? 'CAROUSEL'
    : isVideoItem(item) ? (isReelItem(item) ? 'REEL' : 'VIDEO') : 'IMAGE'

  try {
    return normalizeInstagramPost({
      externalId,
      shortcode,
      username,
      caption: stringValue(item.caption),
      publishedAt,
      permalink: permalinkFor(item, shortcode),
      mediaType,
      media,
    })
  } catch (error) {
    if (error instanceof InstagramProviderError && error.code === 'INVALID_DATA') {
      throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset item 不符合统一 contract', { cause: error })
    }
    throw error
  }
}

export type ApifyDatasetOwnerValidation = {
  requestedTarget: string
  resolvedDatasetTarget: string | null
  recognizedOwners: string[]
  ownerResolutionSource: Record<string, number>
  itemCount: number
  validOwnerItemCount: number
  unknownOwnerItemCount: number
  mismatchedOwnerItemCount: number
  directOwnerItemCount: number
  collaboratorItemCount: number
  foreignItemCount: number
  unknownItemCount: number
  resolvedOwners: Array<string | null>
  relationships: InstagramTargetRelationship[]
}

function inspectApifyDatasetOwners(items: readonly unknown[], target: string): ApifyDatasetOwnerValidation {
  const requestedTarget = normalizeInstagramUsername(target)
  const resolutions = items.map(resolveInstagramOwnerUsername)
  const resolvedOwners = resolutions.map((resolution) => resolution.username)
  const relationships = items.map((item) => classifyInstagramTargetRelationship(item, requestedTarget))
  const recognizedOwners = [...new Set(resolvedOwners.filter((owner): owner is string => Boolean(owner)))].sort()
  const ownerResolutionSource: Record<string, number> = {}
  for (const resolution of resolutions) {
    if (resolution.source) ownerResolutionSource[resolution.source] = (ownerResolutionSource[resolution.source] || 0) + 1
  }
  const directOwnerItemCount = relationships.filter((relationship) => relationship === 'DIRECT_OWNER').length
  const collaboratorItemCount = relationships.filter((relationship) => relationship === 'COLLABORATOR').length
  const foreignItemCount = relationships.filter((relationship) => relationship === 'FOREIGN').length
  const unknownItemCount = relationships.filter((relationship) => relationship === 'UNVERIFIABLE').length
  return {
    requestedTarget,
    resolvedDatasetTarget: recognizedOwners.length === 1 ? recognizedOwners[0]! : null,
    recognizedOwners,
    ownerResolutionSource,
    itemCount: items.length,
    validOwnerItemCount: resolvedOwners.filter((owner): owner is string => Boolean(owner)).length,
    unknownOwnerItemCount: resolvedOwners.filter((owner) => !owner).length,
    mismatchedOwnerItemCount: resolvedOwners.filter((owner) => Boolean(owner) && owner !== requestedTarget).length,
    directOwnerItemCount,
    collaboratorItemCount,
    foreignItemCount,
    unknownItemCount,
    resolvedOwners,
    relationships,
  }
}

function profileFeedSourceUsername(value: unknown) {
  const item = asRecord(value)
  if (!item) return null
  for (const key of ['inputUrl', 'profileUrl', 'url']) {
    const username = profileUsernameFromInputValue(item[key])
    if (username) return username
  }
  return null
}

function assertApifyDatasetTarget(validation: ApifyDatasetOwnerValidation, runInputTarget?: string | null, items: readonly unknown[] = []) {
  const normalizedRunInputTarget = runInputTarget ? normalizedUsernameCandidate(runInputTarget) : null
  if (runInputTarget && !normalizedRunInputTarget) {
    throw new InstagramProviderError('PROVIDER_TARGET_MISMATCH', 'Apify Run input target 无法识别')
  }
  if (normalizedRunInputTarget && normalizedRunInputTarget !== validation.requestedTarget) {
    throw new InstagramProviderError('PROVIDER_TARGET_MISMATCH', 'Apify Run input target 与请求账号不一致')
  }
  const profileSources = items.map(profileFeedSourceUsername)
  if (profileSources.some((source) => source !== null && source !== validation.requestedTarget)) {
    throw new InstagramProviderError('PROVIDER_TARGET_MISMATCH', 'Apify Dataset profile feed 来源与请求账号不一致')
  }
  const runConfirmsProfileSource = normalizedRunInputTarget === validation.requestedTarget
  const collaboratorWithoutSourceEvidence = validation.relationships.some((relationship, index) => (
    relationship === 'COLLABORATOR'
      && !runConfirmsProfileSource
      && profileSources[index] !== validation.requestedTarget
  ))
  if (collaboratorWithoutSourceEvidence) {
    throw new InstagramProviderError('PROVIDER_TARGET_MISMATCH', 'Apify 联名帖缺少目标 profile feed 来源证据')
  }
  if (!validation.recognizedOwners.length || validation.unknownItemCount > 0) {
    throw new InstagramProviderError('APIFY_DATASET_TARGET_UNVERIFIABLE', 'Apify Dataset 存在无法确认 owner 的帖子')
  }
  if (validation.foreignItemCount > 0) {
    throw new InstagramProviderError('APIFY_DATASET_MIXED_OWNERS', 'Apify Dataset 包含未授权的 foreign owner 帖子')
  }
  if (validation.directOwnerItemCount + validation.collaboratorItemCount === 0) {
    throw new InstagramProviderError('PROVIDER_TARGET_MISMATCH', 'Apify Dataset 未包含目标账号帖子或目标联名帖')
  }
}

/**
 * Validates every returned post row before any row can enter the shared
 * normalizer. Foreign and unverifiable rows remain fail-closed, while a
 * strong coauthor/collaborator relationship is accepted as target content.
 */
export function validateApifyDatasetTarget(items: readonly unknown[], target: string, runInputTarget?: string | null) {
  const validation = inspectApifyDatasetOwners(items, target)
  assertApifyDatasetTarget(validation, runInputTarget, items)
  return validation
}

function finiteNonNegative(value: unknown) {
  const number = numberValue(value)
  return number !== null && number >= 0 ? number : null
}

function dateValue(value: unknown) {
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function parseRun(value: unknown): ApifyRun {
  const wrapper = asRecord(value)
  const item = asRecord(wrapper?.data ?? value)
  const id = stringValue(item?.id)
  const status = stringValue(item?.status)
  if (!id || !status) throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Run response 缺少状态字段')

  const stats = asRecord(item?.stats)
  return {
    id,
    status,
    defaultDatasetId: stringValue(item?.defaultDatasetId),
    startedAt: dateValue(item?.startedAt),
    finishedAt: dateValue(item?.finishedAt),
    usageTotalUsd: finiteNonNegative(item?.usageTotalUsd),
    billableResults: finiteNonNegative(item?.billableResults) ?? finiteNonNegative(stats?.billableResults),
    inputTarget: resolveApifyRunInputTarget(item?.input ?? item?.runInput),
  }
}

function readDatasetItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const wrapper = asRecord(value)
  if (Array.isArray(wrapper?.items)) return wrapper.items
  throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset response 不是数组')
}

function isApifyErrorRow(value: unknown) {
  const item = asRecord(value)
  return item?.section === 'accounting' || Boolean(stringValue(item?.errorReason))
}

function errorForHttpStatus(status: number, retryAfter: string | null) {
  if (status === 401 || status === 403) {
    return new InstagramProviderError('PROVIDER_AUTH_ERROR', 'Apify API 鉴权失败')
  }
  if (status === 429) {
    const seconds = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : undefined
    return new InstagramProviderError('PROVIDER_RATE_LIMITED', 'Apify API 返回限流', { retryAfterSeconds: seconds })
  }
  return new InstagramProviderError('PROVIDER_REQUEST_FAILED', `Apify API 请求失败（HTTP ${status}）`)
}

function networkDetails(error: unknown) {
  const root = asRecord(error)
  const cause = asRecord(root?.cause)
  const stringOrNull = (value: unknown) => typeof value === 'string' && value ? value : null
  const errno = typeof cause?.errno === 'string' || typeof cause?.errno === 'number' ? cause.errno : null
  return {
    name: stringOrNull(root?.name),
    code: stringOrNull(root?.code),
    causeCode: stringOrNull(cause?.code),
    causeErrno: errno,
    causeSyscall: stringOrNull(cause?.syscall),
    causeHostname: stringOrNull(cause?.hostname),
  }
}

function cloneDiagnostics(value: ApifyProviderDiagnostics | null) {
  if (!value) return null
  return {
    ...value,
    recognizedOwners: [...value.recognizedOwners],
    ownerResolutionSource: { ...value.ownerResolutionSource },
    rawItemKeys: value.rawItemKeys.map((keys) => [...keys]),
    rawItemTypes: [...value.rawItemTypes],
    childPostsCounts: [...value.childPostsCounts],
  }
}

export class ApifyInstagramProvider implements InstagramProvider {
  readonly name = 'apify' as const
  /** Apify executes the scraper in its own environment; any proxy is explicit and provider-scoped. */
  readonly proxyUrl: string | null

  private readonly token: string | null
  private readonly fetchImpl: FetchImplementation
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly runTimeoutMs: number
  private readonly pollIntervalMs: number
  private readonly costSettleDelayMs: number
  private apiRequests = 0
  private diagnostics: ApifyProviderDiagnostics | null = null
  private trace: InstagramProviderTrace | null = null

  constructor(options: ApifyInstagramProviderOptions = {}) {
    this.token = process.env.APIFY_API_TOKEN?.trim() || null
    this.proxyUrl = normalizeProxyUrl(options.proxyUrl !== undefined ? options.proxyUrl : process.env.APIFY_PROXY_URL)
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.runTimeoutMs = options.runTimeoutMs ?? APIFY_RUN_TIMEOUT_MS
    this.pollIntervalMs = options.pollIntervalMs ?? APIFY_RUN_POLL_INTERVAL_MS
    this.costSettleDelayMs = options.costSettleDelayMs ?? APIFY_COST_SETTLE_DELAY_MS
  }

  getDiagnostics() {
    return cloneDiagnostics(this.diagnostics)
  }

  getTrace() {
    return this.trace ? {
      ...this.trace,
      runStartedAt: this.trace.runStartedAt ? new Date(this.trace.runStartedAt.getTime()) : null,
      runFinishedAt: this.trace.runFinishedAt ? new Date(this.trace.runFinishedAt.getTime()) : null,
    } : null
  }

  private async requestJson(url: URL, init: RequestInit = {}) {
    if (!this.token) throw new InstagramProviderError('PROVIDER_NOT_CONFIGURED', 'APIFY_API_TOKEN 未配置')
    this.apiRequests += 1
    if (this.diagnostics) this.diagnostics.apiRequests = this.apiRequests
    const dispatcher = this.proxyUrl ? new ProxyAgent(this.proxyUrl) : undefined
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          Authorization: `Bearer ${this.token}`,
          ...init.headers,
        },
        ...(dispatcher ? { dispatcher } : {}),
        signal: init.signal ?? AbortSignal.timeout(APIFY_REQUEST_TIMEOUT_MS),
      } as RequestInit)
    } catch (error) {
      const details = networkDetails(error)
      if (details.name === 'TimeoutError' || details.causeCode === 'UND_ERR_CONNECT_TIMEOUT' || details.causeCode === 'UND_ERR_HEADERS_TIMEOUT') {
        throw new InstagramProviderError('PROVIDER_TIMEOUT', 'Apify API 请求超时', { cause: error, network: details })
      }
      throw new InstagramProviderError('PROVIDER_REQUEST_FAILED', 'Apify API 网络请求失败', { cause: error, network: details })
    }

    try {
      if (!response.ok) throw errorForHttpStatus(response.status, response.headers.get('retry-after'))
      try {
        return await response.json() as unknown
      } catch (error) {
        throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify API 返回的 JSON 无法解析', { cause: error })
      }
    } finally {
      if (dispatcher) await dispatcher.close()
    }
  }

  private async getRun(runId: string) {
    const url = new URL(`${APIFY_API_BASE_URL}/actor-runs/${encodeURIComponent(runId)}`)
    return parseRun(await this.requestJson(url))
  }

  private setTrace(run: ApifyRun | null, datasetId: string | null) {
    this.trace = {
      actor: 'apify/instagram-scraper',
      runId: run?.id || null,
      datasetId: datasetId || run?.defaultDatasetId || null,
      runStatus: run?.status || null,
      runStartedAt: run?.startedAt || null,
      runFinishedAt: run?.finishedAt || null,
      usageTotalUsd: run?.usageTotalUsd ?? null,
      billableResults: run?.billableResults ?? null,
    }
    if (this.diagnostics) {
      this.diagnostics.actorRunId = run?.id || null
      this.diagnostics.datasetId = datasetId || run?.defaultDatasetId || null
    }
  }

  private async readAndNormalizeDataset(datasetId: string, target: string, requestedLimit: number, runInputTarget?: string | null) {
    if (!/^[a-zA-Z0-9_-]{1,191}$/.test(datasetId)) throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset ID 格式无效')
    const datasetUrl = new URL(`${APIFY_API_BASE_URL}/datasets/${encodeURIComponent(datasetId)}/items`)
    datasetUrl.searchParams.set('format', 'json')
    // Inspect the full bounded Dataset sample for mixed-owner safety, then
    // return only the caller's requested number of normalized posts.
    datasetUrl.searchParams.set('limit', String(Math.max(requestedLimit, APIFY_DATASET_INSPECTION_LIMIT)))
    const rawItems = readDatasetItems(await this.requestJson(datasetUrl))
    if (this.diagnostics) {
      this.diagnostics.datasetItems = rawItems.length
      this.diagnostics.rawItemKeys = rawItems.map((item) => Object.keys(asRecord(item) || {}).sort())
      this.diagnostics.rawItemTypes = rawItems.map((item) => stringValue(asRecord(item)?.type))
      this.diagnostics.childPostsCounts = rawItems.map((item) => {
        const children = asRecord(item)?.childPosts
        return Array.isArray(children) ? children.length : 0
      })
      this.diagnostics.pinnedDetected = rawItems.some((item) => asRecord(item)?.isPinned === true)
    }

    if (!rawItems.length) throw new InstagramProviderError('PROVIDER_EMPTY_RESULT', 'Apify Dataset 没有返回结果')
    const postItems = rawItems.filter((item) => !isApifyErrorRow(item))
    if (!postItems.length) throw new InstagramProviderError('PROVIDER_EMPTY_RESULT', 'Apify 返回空帖子结果')
    if (this.diagnostics) this.diagnostics.postItems = postItems.length

    const ownerValidation = inspectApifyDatasetOwners(postItems, target)
    if (this.diagnostics) {
      this.diagnostics.requestedTarget = ownerValidation.requestedTarget
      this.diagnostics.resolvedDatasetTarget = ownerValidation.resolvedDatasetTarget
      this.diagnostics.recognizedOwners = [...ownerValidation.recognizedOwners]
      this.diagnostics.ownerResolutionSource = { ...ownerValidation.ownerResolutionSource }
      this.diagnostics.itemCount = ownerValidation.itemCount
      this.diagnostics.validOwnerItemCount = ownerValidation.validOwnerItemCount
      this.diagnostics.unknownOwnerItemCount = ownerValidation.unknownOwnerItemCount
      this.diagnostics.mismatchedOwnerItemCount = ownerValidation.mismatchedOwnerItemCount
      this.diagnostics.directOwnerItemCount = ownerValidation.directOwnerItemCount
      this.diagnostics.collaboratorItemCount = ownerValidation.collaboratorItemCount
      this.diagnostics.foreignItemCount = ownerValidation.foreignItemCount
      this.diagnostics.unknownItemCount = ownerValidation.unknownItemCount
      this.diagnostics.targetPosts = ownerValidation.directOwnerItemCount + ownerValidation.collaboratorItemCount
      // Kept for backwards-compatible diagnostics; foreign rows are never
      // silently skipped because the dataset remains fail-closed.
      this.diagnostics.foreignOwnerSkipped = 0
    }
    assertApifyDatasetTarget(ownerValidation, runInputTarget, postItems)

    const inputUrlUsernames = postItems
      .map((item) => profileUsernameFromUrl(asRecord(item)?.inputUrl))
      .filter((username): username is string => Boolean(username))
    if (inputUrlUsernames.some((username) => username.toLowerCase() !== target.toLowerCase())) {
      throw new InstagramProviderError('PROVIDER_TARGET_MISMATCH', 'Apify Dataset inputUrl 与请求账号不一致')
    }

    let normalized: InstagramPost[]
    try {
      normalized = postItems.map(normalizeApifyInstagramItem)
    } catch (error) {
      if (error instanceof InstagramProviderError && error.code === 'PROVIDER_CONTRACT_FAILED') throw error
      throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset 无法 normalize', { cause: error })
    }
    if (this.diagnostics) {
      this.diagnostics.targetPosts = normalized.length
    }

    const uniqueIds = new Set(normalized.map((post) => post.externalId))
    if (this.diagnostics) this.diagnostics.duplicateExternalIds = normalized.length - uniqueIds.size
    return dedupeAndSortInstagramPosts(normalized, requestedLimit)
  }

  private async waitForRun(initialRun: ApifyRun) {
    let run = initialRun
    const deadline = Date.now() + this.runTimeoutMs
    while (!TERMINAL_RUN_STATUSES.has(run.status)) {
      if (Date.now() >= deadline) throw new InstagramProviderError('PROVIDER_TIMEOUT', 'Apify Actor Run 等待超时')
      await this.sleep(this.pollIntervalMs)
      run = await this.getRun(run.id)
    }
    return run
  }

  async getLatestPosts(username: string, limit: number): Promise<InstagramPost[]> {
    const target = normalizeInstagramUsername(username)
    const requestedLimit = normalizeProviderLimit(limit)
    if (!this.token) throw new InstagramProviderError('PROVIDER_NOT_CONFIGURED', 'APIFY_API_TOKEN 未配置')

    this.apiRequests = 0
    this.diagnostics = {
      actor: APIFY_INSTAGRAM_SCRAPER_ACTOR,
      requestedTarget: target,
      datasetId: null,
      actorRunId: null,
      resolvedDatasetTarget: null,
      recognizedOwners: [],
      ownerResolutionSource: {},
      itemCount: 0,
      validOwnerItemCount: 0,
      unknownOwnerItemCount: 0,
      mismatchedOwnerItemCount: 0,
      directOwnerItemCount: 0,
      collaboratorItemCount: 0,
      foreignItemCount: 0,
      unknownItemCount: 0,
      actorRuns: 1,
      apiRequests: 0,
      datasetItems: 0,
      postItems: 0,
      targetPosts: 0,
      foreignOwnerSkipped: 0,
      runStatus: null,
      usageTotalUsd: null,
      billableResults: null,
      pinnedDetected: false,
      duplicateExternalIds: 0,
      rawItemKeys: [],
      rawItemTypes: [],
      childPostsCounts: [],
    }
    this.trace = null

    const runUrl = new URL(`${APIFY_API_BASE_URL}/actors/${APIFY_INSTAGRAM_SCRAPER_ACTOR}/runs`)
    runUrl.searchParams.set('waitForFinish', '0')
    runUrl.searchParams.set('restartOnError', 'false')
    runUrl.searchParams.set('maxItems', String(requestedLimit))
    runUrl.searchParams.set('timeout', String(Math.floor(APIFY_RUN_TIMEOUT_MS / 1000)))
    const run = await this.waitForRun(parseRun(await this.requestJson(runUrl, {
      method: 'POST',
      body: JSON.stringify({
        directUrls: [`https://www.instagram.com/${target}/`],
        // Keep the Actor in profile/user mode even when a task has a stale
        // search default. No search query or tagged-feed URL is supplied.
        searchType: 'user',
        resultsType: 'posts',
        resultsLimit: requestedLimit,
        skipPinnedPosts: false,
      }),
    })))

    this.diagnostics.runStatus = run.status
    this.diagnostics.usageTotalUsd = run.usageTotalUsd
    this.diagnostics.billableResults = run.billableResults
    this.setTrace(run, run.defaultDatasetId)
    if (run.status !== 'SUCCEEDED') {
      throw new InstagramProviderError('PROVIDER_RUN_FAILED', 'Apify Actor Run 未成功完成')
    }
    if (!run.defaultDatasetId) throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Run 缺少 defaultDatasetId')

    const normalized = await this.readAndNormalizeDataset(run.defaultDatasetId, target, requestedLimit, run.inputTarget)

    if (this.diagnostics.usageTotalUsd === null && this.costSettleDelayMs > 0) {
      await this.sleep(this.costSettleDelayMs)
      const finalizedRun = await this.getRun(run.id)
      this.diagnostics.runStatus = finalizedRun.status
      this.diagnostics.usageTotalUsd = finalizedRun.usageTotalUsd
      this.diagnostics.billableResults = finalizedRun.billableResults
      this.setTrace(finalizedRun, run.defaultDatasetId)
    }

    this.diagnostics.apiRequests = this.apiRequests
    return normalized
  }

  /** Read an existing Dataset without creating or polling an Actor Run. */
  async getLatestPostsFromDataset(datasetId: string, username: string, limit: number): Promise<InstagramPost[]> {
    const target = normalizeInstagramUsername(username)
    const requestedLimit = normalizeProviderLimit(limit)
    if (!this.token) throw new InstagramProviderError('PROVIDER_NOT_CONFIGURED', 'APIFY_API_TOKEN 未配置')

    this.apiRequests = 0
    this.trace = null
    this.diagnostics = {
      actor: APIFY_INSTAGRAM_SCRAPER_ACTOR,
      requestedTarget: target,
      datasetId,
      actorRunId: null,
      resolvedDatasetTarget: null,
      recognizedOwners: [],
      ownerResolutionSource: {},
      itemCount: 0,
      validOwnerItemCount: 0,
      unknownOwnerItemCount: 0,
      mismatchedOwnerItemCount: 0,
      directOwnerItemCount: 0,
      collaboratorItemCount: 0,
      foreignItemCount: 0,
      unknownItemCount: 0,
      actorRuns: 0,
      apiRequests: 0,
      datasetItems: 0,
      postItems: 0,
      targetPosts: 0,
      foreignOwnerSkipped: 0,
      runStatus: 'SUCCEEDED',
      usageTotalUsd: null,
      billableResults: null,
      pinnedDetected: false,
      duplicateExternalIds: 0,
      rawItemKeys: [],
      rawItemTypes: [],
      childPostsCounts: [],
    }
    this.setTrace(null, datasetId)
    const posts = await this.readAndNormalizeDataset(datasetId, target, requestedLimit)
    this.diagnostics.apiRequests = this.apiRequests
    return posts
  }
}
