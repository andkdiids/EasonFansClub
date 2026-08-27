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

type UnknownRecord = Record<string, unknown>
type FetchImplementation = typeof fetch

export type ApifyProviderDiagnostics = {
  actor: typeof APIFY_INSTAGRAM_SCRAPER_ACTOR
  actorRuns: number
  apiRequests: number
  datasetItems: number
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
  const username = stringValue(item.ownerUsername)
    || stringValue(item.username)
    || stringValue(asRecord(item.owner)?.username)
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
  }

  private async readAndNormalizeDataset(datasetId: string, target: string, requestedLimit: number) {
    if (!/^[a-zA-Z0-9_-]{1,191}$/.test(datasetId)) throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset ID 格式无效')
    const datasetUrl = new URL(`${APIFY_API_BASE_URL}/datasets/${encodeURIComponent(datasetId)}/items`)
    datasetUrl.searchParams.set('format', 'json')
    datasetUrl.searchParams.set('limit', String(requestedLimit))
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

    let normalized: InstagramPost[]
    try {
      normalized = postItems.map(normalizeApifyInstagramItem)
    } catch (error) {
      if (error instanceof InstagramProviderError && error.code === 'PROVIDER_CONTRACT_FAILED') throw error
      throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset 无法 normalize', { cause: error })
    }
    if (normalized.some((post) => post.username !== target)) {
      throw new InstagramProviderError('PROVIDER_CONTRACT_FAILED', 'Apify Dataset target 与请求账号不一致')
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
      actorRuns: 1,
      apiRequests: 0,
      datasetItems: 0,
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

    const normalized = await this.readAndNormalizeDataset(run.defaultDatasetId, target, requestedLimit)

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
      actorRuns: 0,
      apiRequests: 0,
      datasetItems: 0,
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
