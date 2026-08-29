import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { Readable, Transform } from 'node:stream'
import COS from 'cos-nodejs-sdk-v5'
import sharp from 'sharp'
import { ProxyAgent } from 'undici'
import type { InstagramMedia } from '@/lib/instagram/types'
import { buildInstagramMediaStorageKey, buildInstagramStoragePrefix, getAnywhereDoorStorageMode, type AnywhereDoorStorageMode } from '@/lib/anywhere-door/config'
import { putCosObjectWithAclFallback, readCosEnv } from '@/lib/tencent-cos'

export const MEDIA_CONNECT_TIMEOUT_MS = 10_000
export const MEDIA_REQUEST_TIMEOUT_MS = 20_000

export type MediaInspection = {
  status: number
  contentType: string | null
  contentLength: number | null
  method: 'HEAD' | 'RANGE'
  hostname: string
  redirects: number
}

type MediaLookup = typeof lookup
type MediaFetch = typeof fetch

export type MediaRequestOptions = {
  fetchImpl?: MediaFetch
  lookupImpl?: MediaLookup
  proxyUrl?: string | null
  maxRedirects?: number
  retrySleepImpl?: (milliseconds: number) => Promise<void>
}

export type InstagramMediaFailureStage = 'inspect' | 'download' | 'thumbnail' | 'upload'

export type InstagramMediaFailureDiagnostics = {
  postExternalId?: string | null
  sortOrder?: number | null
  mediaType?: InstagramMedia['type'] | null
  stage?: InstagramMediaFailureStage | null
  hostname?: string | null
  status?: number | null
  redirects?: number
  errorName?: string | null
  errorMessage?: string | null
  causeCode?: string | number | null
  proxyConfigured?: boolean
}

export class InstagramMediaSafetyError extends Error {
  readonly code:
  | 'UNSAFE_URL'
  | 'MEDIA_HOST_NOT_ALLOWED'
  | 'MEDIA_DNS_FAILED'
  | 'MEDIA_TOO_LARGE'
  | 'MEDIA_CONTENT_TYPE_INVALID'
  | 'MEDIA_REQUEST_FAILED'
  | 'MEDIA_STREAMING_REQUIRED'
  | 'COS_ERROR'
  | 'CONFIG_ERROR'

  readonly diagnostics: InstagramMediaFailureDiagnostics | null

  constructor(code: InstagramMediaSafetyError['code'], message: string, diagnostics: InstagramMediaFailureDiagnostics | null = null) {
    super(message)
    this.name = 'InstagramMediaSafetyError'
    this.code = code
    this.diagnostics = diagnostics
  }
}

type MediaHostRule = { exact: string | null; suffix: string | null }

/**
 * The current Apify Dataset contains Meta-hosted Instagram media only. Keep
 * this reviewed set deliberately small: a missing or malformed environment
 * value must never turn the media downloader into an arbitrary HTTPS proxy.
 */
export const APPROVED_MEDIA_HOST_SUFFIXES = ['cdninstagram.com', 'fbcdn.net'] as const
export const DEFAULT_ALLOWED_MEDIA_HOSTS = '.cdninstagram.com,.fbcdn.net'

function configuredHosts(value = process.env.IG_ALLOWED_MEDIA_HOSTS || ''): MediaHostRule[] {
  return value
    .split(',')
    .map((raw) => raw.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean)
    .map((raw) => {
      const suffix = raw.replace(/^\*\.?/, '').replace(/^\.+/, '')
      return raw.startsWith('.') || raw.startsWith('*.')
        ? { exact: null, suffix }
        : { exact: suffix, suffix: null }
    })
}

function ipv4Parts(value: string) {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return parts as [number, number, number, number]
}

function ipv4InRange(parts: [number, number, number, number], start: [number, number, number, number], end: [number, number, number, number]) {
  const value = parts[0] * 0x1000000 + parts[1] * 0x10000 + parts[2] * 0x100 + parts[3]
  const first = start[0] * 0x1000000 + start[1] * 0x10000 + start[2] * 0x100 + start[3]
  const last = end[0] * 0x1000000 + end[1] * 0x10000 + end[2] * 0x100 + end[3]
  return value >= first && value <= last
}

function isRestrictedIpv4(value: string) {
  const parts = ipv4Parts(value)
  if (!parts) return true
  return ipv4InRange(parts, [0, 0, 0, 0], [0, 255, 255, 255])
    || ipv4InRange(parts, [10, 0, 0, 0], [10, 255, 255, 255])
    || ipv4InRange(parts, [100, 64, 0, 0], [100, 127, 255, 255])
    || ipv4InRange(parts, [127, 0, 0, 0], [127, 255, 255, 255])
    || ipv4InRange(parts, [169, 254, 0, 0], [169, 254, 255, 255])
    || ipv4InRange(parts, [172, 16, 0, 0], [172, 31, 255, 255])
    || ipv4InRange(parts, [192, 0, 0, 0], [192, 0, 0, 255])
    || ipv4InRange(parts, [192, 0, 2, 0], [192, 0, 2, 255])
    || ipv4InRange(parts, [192, 168, 0, 0], [192, 168, 255, 255])
    || ipv4InRange(parts, [198, 18, 0, 0], [198, 19, 255, 255])
    || ipv4InRange(parts, [198, 51, 100, 0], [198, 51, 100, 255])
    || ipv4InRange(parts, [203, 0, 113, 0], [203, 0, 113, 255])
    || ipv4InRange(parts, [224, 0, 0, 0], [255, 255, 255, 255])
}

function parseIpv6(value: string) {
  let normalized = value.toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized.includes('%')) return null
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':')
    const ipv4 = normalized.slice(lastColon + 1)
    const parts = ipv4Parts(ipv4)
    if (!parts) return null
    const high = ((parts[0] << 8) | parts[1]).toString(16)
    const low = ((parts[2] << 8) | parts[3]).toString(16)
    normalized = `${normalized.slice(0, lastColon + 1)}${high}:${low}`
  }
  const sections = normalized.split('::')
  if (sections.length > 2) return null
  const head = sections[0] ? sections[0].split(':') : []
  const tail = sections.length === 2 && sections[1] ? sections[1].split(':') : []
  const groups = [...head, ...tail].map((part) => Number.parseInt(part, 16))
  if (groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) return null
  if (sections.length === 1 && groups.length !== 8) return null
  const missing = 8 - groups.length
  if (sections.length === 2 && missing < 1) return null
  const expanded = sections.length === 2
    ? [...head.map((part) => Number.parseInt(part, 16)), ...Array.from({ length: missing }, () => 0), ...tail.map((part) => Number.parseInt(part, 16))]
    : groups
  return expanded.length === 8 ? expanded.flatMap((group) => [group >> 8, group & 0xff]) : null
}

function ipv6HasPrefix(bytes: number[], prefix: number, expected: number[]) {
  for (let bit = 0; bit < prefix; bit += 1) {
    const actualBit = (bytes[Math.floor(bit / 8)]! >> (7 - (bit % 8))) & 1
    const expectedBit = (expected[Math.floor(bit / 8)]! >> (7 - (bit % 8))) & 1
    if (actualBit !== expectedBit) return false
  }
  return true
}

function isRestrictedIpv6(value: string) {
  const bytes = parseIpv6(value)
  if (!bytes) return true
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff && bytes[11] === 0xff
  if (mappedIpv4) {
    return isRestrictedIpv4(bytes.slice(12).join('.'))
  }
  return bytes.every((byte) => byte === 0)
    || ipv6HasPrefix(bytes, 128, Array.from({ length: 15 }, () => 0).concat(1))
    || ipv6HasPrefix(bytes, 7, [0xfc])
    || ipv6HasPrefix(bytes, 10, [0xfe, 0x80])
    || ipv6HasPrefix(bytes, 8, [0xff])
    || ipv6HasPrefix(bytes, 32, [0x20, 0x01, 0x0d, 0xb8])
}

export function isRestrictedIp(value: string) {
  const normalized = value.trim().toLowerCase()
  if (isIP(normalized) === 4) return isRestrictedIpv4(normalized)
  if (isIP(normalized) === 6) return isRestrictedIpv6(normalized)
  return true
}

export function isAllowedMediaHostname(hostname: string, allowlist?: string) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!normalized || isIP(normalized)) return false
  const configured = configuredHosts(allowlist ?? (process.env.IG_ALLOWED_MEDIA_HOSTS || DEFAULT_ALLOWED_MEDIA_HOSTS))
  const rules = process.env.NODE_ENV === 'production' && allowlist === undefined
    ? configured.filter((rule) => rule.suffix && APPROVED_MEDIA_HOST_SUFFIXES.includes(rule.suffix as typeof APPROVED_MEDIA_HOST_SUFFIXES[number]))
    : configured
  return rules.some((rule) => rule.exact === normalized || Boolean(rule.suffix && (normalized === rule.suffix || normalized.endsWith(`.${rule.suffix}`))))
}

function normalizedHostname(parsed: URL) {
  return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
}

function validateMediaUrlSyntaxAndHost(sourceUrl: string) {
  let parsed: URL
  try {
    parsed = new URL(sourceUrl)
  } catch {
    throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体地址不是有效 URL')
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体地址必须是无凭据的 HTTPS URL')
  }
  const hostname = normalizedHostname(parsed)
  if (!hostname) {
    throw new InstagramMediaSafetyError('MEDIA_HOST_NOT_ALLOWED', '媒体域名不在允许列表中')
  }
  if (isIP(hostname)) {
    if (isRestrictedIp(hostname)) throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体地址指向受限制的 IP 地址')
    throw new InstagramMediaSafetyError('MEDIA_HOST_NOT_ALLOWED', '媒体域名不在允许列表中')
  }
  if (!isAllowedMediaHostname(hostname)) {
    throw new InstagramMediaSafetyError('MEDIA_HOST_NOT_ALLOWED', '媒体域名不在允许列表中')
  }
  return { parsed, hostname }
}

async function assertPublicMediaUrl(sourceUrl: string, options: MediaRequestOptions = {}) {
  const { parsed, hostname } = validateMediaUrlSyntaxAndHost(sourceUrl)

  // With an explicit media proxy, the proxy performs the target DNS lookup.
  // Requiring the production host's local resolver here would reject valid
  // media when systemd-resolved cannot resolve Meta CDN names. The URL and
  // redirect allowlist checks above still run for every hop.
  if (options.proxyUrl?.trim()) return parsed

  let addresses: Array<{ address: string }>
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    addresses = await Promise.race([
      (options.lookupImpl || lookup)(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new InstagramMediaSafetyError('MEDIA_DNS_FAILED', '媒体域名 DNS 解析超时')), MEDIA_CONNECT_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    if (error instanceof InstagramMediaSafetyError) throw error
    const details = extractErrorDetails(error)
    throw new InstagramMediaSafetyError('MEDIA_DNS_FAILED', '媒体域名 DNS 解析失败', {
      hostname,
      status: null,
      redirects: 0,
      errorName: details.errorName,
      errorMessage: sanitizeDiagnosticText(details.errorMessage),
      causeCode: retryableCauseCode(details.codes),
      proxyConfigured: false,
    })
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  if (!addresses.length || addresses.some(({ address }) => isRestrictedIp(address))) {
    throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体域名解析到受限制的内网地址')
  }
  return parsed
}

function limitForMedia(media: Pick<InstagramMedia, 'type'>) {
  const envName = media.type === 'VIDEO' ? 'IG_MAX_VIDEO_MB' : 'IG_MAX_IMAGE_MB'
  const defaultMb = media.type === 'VIDEO' ? 500 : 20
  const configured = Number(process.env[envName])
  const megabytes = Number.isFinite(configured) && configured > 0 ? configured : defaultMb
  return Math.floor(megabytes * 1024 * 1024)
}

function contentTypeAllowed(mediaType: InstagramMedia['type'], contentType: string | null) {
  if (!contentType) return false
  const normalized = contentType.split(';', 1)[0].trim().toLowerCase()
  return mediaType === 'VIDEO'
    ? normalized === 'video/mp4'
    : ['image/jpeg', 'image/png', 'image/webp'].includes(normalized)
}

function requestSignal(timeoutMs: number) {
  return AbortSignal.timeout(Math.max(1, timeoutMs))
}

const MEDIA_RETRY_DELAYS_MS = [500, 1_500] as const
const MEDIA_MAX_ATTEMPTS = MEDIA_RETRY_DELAYS_MS.length + 1
const RETRYABLE_MEDIA_CAUSE_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNABORTED',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
])

type MediaFailureContext = {
  postExternalId?: string
  sortOrder?: number
  mediaType?: InstagramMedia['type']
  stage?: InstagramMediaFailureStage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractErrorDetails(error: unknown) {
  const codes: Array<string | number> = []
  const visited = new Set<unknown>()
  let errorName: string | null = null
  let errorMessage: string | null = null

  const visit = (value: unknown) => {
    if (!isRecord(value) || visited.has(value)) return
    visited.add(value)
    if (!errorName && typeof value.name === 'string') errorName = value.name
    if (!errorMessage && typeof value.message === 'string') errorMessage = value.message
    if ((typeof value.code === 'string' || typeof value.code === 'number') && !codes.includes(value.code)) codes.push(value.code)
    if ('cause' in value) visit(value.cause)
    if (Array.isArray(value.errors)) value.errors.forEach(visit)
  }
  visit(error)
  return { errorName, errorMessage, codes }
}

function sanitizeDiagnosticText(value: string | null | undefined) {
  if (!value) return null
  const withoutUrls = value.replace(/https?:\/\/[^\s"'<>]+/gi, (rawUrl) => {
    try {
      const parsed = new URL(rawUrl.replace(/[),.;]+$/g, ''))
      return `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`
    } catch {
      return '[redacted-url]'
    }
  })
  return withoutUrls
    .replace(/\b(authorization|bearer|token|secret|password|sessionid|csrftoken|apikey)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, 160)
}

function retryableCauseCode(codes: Array<string | number>) {
  return codes.find((code) => RETRYABLE_MEDIA_CAUSE_CODES.has(String(code).toUpperCase())) ?? codes[0] ?? null
}

function safeHostname(sourceUrl: string) {
  try {
    return normalizedHostname(new URL(sourceUrl))
  } catch {
    return null
  }
}

function baseMediaFailureDiagnostics(
  error: unknown,
  options: MediaRequestOptions,
  sourceUrl: string,
  context: MediaFailureContext,
  redirects: number,
  status?: number | null,
): InstagramMediaFailureDiagnostics {
  const details = error instanceof InstagramMediaSafetyError ? null : extractErrorDetails(error)
  return {
    postExternalId: context.postExternalId ?? null,
    sortOrder: context.sortOrder ?? null,
    mediaType: context.mediaType ?? null,
    stage: context.stage ?? null,
    hostname: safeHostname(sourceUrl),
    status: status ?? null,
    redirects,
    errorName: details?.errorName ?? null,
    errorMessage: sanitizeDiagnosticText(details?.errorMessage),
    causeCode: details ? retryableCauseCode(details.codes) : null,
    proxyConfigured: Boolean(options.proxyUrl?.trim()),
  }
}

function withMediaFailureDiagnostics(
  error: unknown,
  options: MediaRequestOptions,
  sourceUrl: string,
  context: MediaFailureContext,
  redirects: number,
  status?: number | null,
  codeOverride?: InstagramMediaSafetyError['code'],
) {
  const existing = error instanceof InstagramMediaSafetyError ? error.diagnostics : null
  const diagnostics = {
    ...baseMediaFailureDiagnostics(error, options, sourceUrl, context, redirects, status),
    ...(existing || {}),
  }
  if (context.postExternalId !== undefined) diagnostics.postExternalId = context.postExternalId
  if (context.sortOrder !== undefined) diagnostics.sortOrder = context.sortOrder
  if (context.mediaType !== undefined) diagnostics.mediaType = context.mediaType
  if (context.stage !== undefined) diagnostics.stage = context.stage
  if (status !== undefined) diagnostics.status = status
  diagnostics.redirects = redirects
  diagnostics.hostname = safeHostname(sourceUrl) ?? diagnostics.hostname ?? null
  diagnostics.proxyConfigured = Boolean(options.proxyUrl?.trim())

  const code = codeOverride || (error instanceof InstagramMediaSafetyError ? error.code : 'MEDIA_REQUEST_FAILED')
  const message = error instanceof InstagramMediaSafetyError
    ? sanitizeDiagnosticText(error.message) || '媒体请求失败'
    : sanitizeDiagnosticText(extractErrorDetails(error).errorMessage) || '媒体请求失败'
  if (!diagnostics.errorMessage) diagnostics.errorMessage = message
  return new InstagramMediaSafetyError(code, message, diagnostics)
}

function createMediaResponseFailure(
  message: string,
  options: MediaRequestOptions,
  sourceUrl: string,
  context: MediaFailureContext,
  redirects: number,
  status: number,
) {
  return new InstagramMediaSafetyError('MEDIA_REQUEST_FAILED', message, {
    ...baseMediaFailureDiagnostics(null, options, sourceUrl, context, redirects, status),
    errorName: 'ResponseError',
    errorMessage: `HTTP ${status}`,
    causeCode: null,
  })
}

function isRetryableMediaFailure(error: unknown) {
  if (!(error instanceof InstagramMediaSafetyError) || error.code !== 'MEDIA_REQUEST_FAILED') return false
  const status = error.diagnostics?.status
  if (status !== null && status !== undefined) return status >= 500 && status <= 599
  const causeCode = error.diagnostics?.causeCode
  if (causeCode !== null && causeCode !== undefined && RETRYABLE_MEDIA_CAUSE_CODES.has(String(causeCode).toUpperCase())) return true
  if (error.diagnostics?.errorName === 'TimeoutError') return true
  return error.diagnostics?.errorName === 'TypeError' && error.diagnostics.errorMessage?.trim().toLowerCase() === 'fetch failed'
}

function isRetryableStatus(status: number) {
  return status >= 500 && status <= 599
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function proxyAgent(proxyUrl?: string | null) {
  if (!proxyUrl?.trim()) return null
  try {
    const parsed = new URL(proxyUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
    return new ProxyAgent(parsed.toString())
  } catch {
    throw new InstagramMediaSafetyError('MEDIA_REQUEST_FAILED', '媒体代理地址无效')
  }
}

function isRedirect(status: number) {
  return [301, 302, 303, 307, 308].includes(status)
}

type MediaFetchResult = {
  response: Response
  url: URL
  redirects: number
  close: () => Promise<void>
}

async function fetchMediaAttempt(
  sourceUrl: string,
  init: RequestInit,
  options: MediaRequestOptions,
  context: MediaFailureContext,
): Promise<MediaFetchResult> {
  const fetchImpl = options.fetchImpl || fetch
  const maxRedirects = Math.min(5, Math.max(0, Math.floor(options.maxRedirects ?? 5)))
  let dispatcher: ReturnType<typeof proxyAgent> = null
  let dispatcherClosed = false
  const close = async () => {
    if (!dispatcher || dispatcherClosed) return
    dispatcherClosed = true
    await dispatcher.close()
  }
  let currentUrl = sourceUrl
  let redirects = 0
  try {
    dispatcher = proxyAgent(options.proxyUrl)
    let current = await assertPublicMediaUrl(sourceUrl, options)
    currentUrl = current.toString()
    while (true) {
      let response: Response
      try {
        response = await fetchImpl(current, {
          ...init,
          redirect: 'manual',
          signal: init.signal || requestSignal(MEDIA_REQUEST_TIMEOUT_MS),
          ...(dispatcher ? { dispatcher } : {}),
        } as RequestInit)
      } catch (error) {
        throw withMediaFailureDiagnostics(
          new InstagramMediaSafetyError('MEDIA_REQUEST_FAILED', sanitizeDiagnosticText(extractErrorDetails(error).errorMessage) || '媒体请求失败', baseMediaFailureDiagnostics(error, options, currentUrl, context, redirects)),
          options,
          currentUrl,
          context,
          redirects,
        )
      }
      if (!isRedirect(response.status)) {
        return {
          response,
          url: current,
          redirects,
          close,
        }
      }
      if (redirects >= maxRedirects) throw new InstagramMediaSafetyError('MEDIA_REQUEST_FAILED', '媒体重定向次数超过限制')
      const location = response.headers.get('location')
      if (!location) throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体重定向缺少目标地址')
      await response.body?.cancel().catch(() => undefined)
      let nextUrl: string
      try {
        nextUrl = new URL(location, current).toString()
      } catch {
        throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体重定向目标地址无效')
      }
      currentUrl = nextUrl
      current = await assertPublicMediaUrl(nextUrl, options)
      redirects += 1
    }
  } catch (error) {
    await close()
    throw withMediaFailureDiagnostics(error, options, currentUrl, context, redirects)
  }
}

async function closeMediaResult(result: MediaFetchResult) {
  await result.response.body?.cancel().catch(() => undefined)
  await result.close()
}

async function fetchMediaWithValidatedRedirects(
  sourceUrl: string,
  init: RequestInit,
  options: MediaRequestOptions,
  context: MediaFailureContext = {},
): Promise<MediaFetchResult> {
  const wait = options.retrySleepImpl || sleep
  let lastFailure: InstagramMediaSafetyError | null = null
  for (let attempt = 0; attempt < MEDIA_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await fetchMediaAttempt(sourceUrl, init, options, context)
      if (isRetryableStatus(result.response.status) && attempt < MEDIA_MAX_ATTEMPTS - 1) {
        await closeMediaResult(result)
        await wait(MEDIA_RETRY_DELAYS_MS[attempt]!)
        continue
      }
      return result
    } catch (error) {
      const failure = error instanceof InstagramMediaSafetyError
        ? error
        : withMediaFailureDiagnostics(error, options, sourceUrl, context, 0)
      lastFailure = failure.diagnostics
        ? failure
        : withMediaFailureDiagnostics(failure, options, sourceUrl, context, 0)
      if (!isRetryableMediaFailure(lastFailure) || attempt >= MEDIA_MAX_ATTEMPTS - 1) throw lastFailure
      await wait(MEDIA_RETRY_DELAYS_MS[attempt]!)
    }
  }
  throw lastFailure || withMediaFailureDiagnostics(
    new InstagramMediaSafetyError('MEDIA_REQUEST_FAILED', '媒体请求失败'),
    options,
    sourceUrl,
    context,
    0,
  )
}

async function inspectResponse(media: Pick<InstagramMedia, 'sourceUrl' | 'type'>, init: RequestInit, options: MediaRequestOptions, method: MediaInspection['method'], redirectOffset = 0) {
  const result = await fetchMediaWithValidatedRedirects(media.sourceUrl, init, options, { stage: 'inspect', mediaType: media.type })
  try {
    const contentLengthHeader = result.response.headers.get('content-length')
    const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : null
    if (contentLength !== null && contentLength > limitForMedia(media)) {
      throw withMediaFailureDiagnostics(new InstagramMediaSafetyError('MEDIA_TOO_LARGE', '媒体超过大小限制'), options, result.url.toString(), { stage: 'inspect', mediaType: media.type }, result.redirects, result.response.status)
    }
    const contentType = result.response.headers.get('content-type')?.trim().toLowerCase() || null
    if (result.response.ok && !contentTypeAllowed(media.type, contentType)) {
      throw withMediaFailureDiagnostics(new InstagramMediaSafetyError('MEDIA_CONTENT_TYPE_INVALID', '媒体 Content-Type 与媒体类型不匹配'), options, result.url.toString(), { stage: 'inspect', mediaType: media.type }, result.redirects, result.response.status)
    }
    await result.response.body?.cancel().catch(() => undefined)
    return { status: result.response.status, contentType, contentLength, method, hostname: result.url.hostname, redirects: redirectOffset + result.redirects, finalUrl: result.url.toString() }
  } finally {
    await result.close()
  }
}

export async function inspectInstagramMediaUrl(media: Pick<InstagramMedia, 'sourceUrl' | 'type'>, options: MediaRequestOptions = {}): Promise<MediaInspection> {
  const head = await inspectResponse(media, { method: 'HEAD' }, options, 'HEAD')
  if (head.status !== 405 && head.status !== 501) {
    return { status: head.status, contentType: head.contentType, contentLength: head.contentLength, method: head.method, hostname: head.hostname, redirects: head.redirects }
  }
  const range = await inspectResponse({ ...media, sourceUrl: head.finalUrl }, { method: 'GET', headers: { Range: 'bytes=0-1023' } }, options, 'RANGE', head.redirects)
  return { status: range.status, contentType: range.contentType, contentLength: range.contentLength, method: range.method, hostname: range.hostname, redirects: range.redirects }
}

export type LocalizedInstagramMedia = {
  storageUrl: string
  thumbnailUrl: string | null
  width: number | null
  height: number | null
  durationMs: number | null
}

export interface InstagramMediaLocalizer {
  localize(media: InstagramMedia, context: { postExternalId: string }): Promise<LocalizedInstagramMedia>
}

/** Mock never leaves the process and therefore cannot introduce a remote URL. */
export class MockInstagramMediaLocalizer implements InstagramMediaLocalizer {
  async localize(media: InstagramMedia) {
    return {
      storageUrl: media.type === 'VIDEO' ? `/anywhere-door/fixtures/mock-video.mp4` : `/anywhere-door/fixtures/mock-image.svg`,
      thumbnailUrl: media.type === 'VIDEO' || media.thumbnailUrl ? `/anywhere-door/fixtures/mock-image.svg` : null,
      width: media.width,
      height: media.height,
      durationMs: media.duration === null ? null : Math.round(media.duration * 1000),
    }
  }
}

export type MediaUploadWriter = {
  upload(params: { key: string; body: Readable; contentType: string; contentLength?: number }): Promise<string>
}

function createCosMediaUploadWriter(): MediaUploadWriter {
  const secretId = readCosEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID')
  const secretKey = readCosEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY')
  const sessionToken = readCosEnv('TENCENT_COS_SESSION_TOKEN', 'COS_SESSION_TOKEN')
  const bucket = readCosEnv('TENCENT_COS_BUCKET', 'COS_BUCKET')
  const region = readCosEnv('TENCENT_COS_REGION', 'COS_REGION')
  if (!secretId || !secretKey || !bucket || !region) {
    throw new InstagramMediaSafetyError('MEDIA_STREAMING_REQUIRED', 'COS 未配置，无法保存外部媒体')
  }

  const client = new COS({
    SecretId: secretId,
    SecretKey: secretKey,
    ...(sessionToken ? { SecurityToken: sessionToken } : {}),
  })
  return {
    async upload({ key, body, contentType, contentLength }) {
      await putCosObjectWithAclFallback(client, {
        Bucket: bucket,
        Region: region,
        Key: key,
        Body: body,
        ContentLength: contentLength,
        ContentType: contentType,
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      })
      return `https://${bucket}.cos.${region}.myqcloud.com/${key}`
    },
  }
}

class ByteLimitTransform extends Transform {
  private total = 0

  constructor(private readonly maxBytes: number) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void) {
    this.total += chunk.byteLength
    if (this.total > this.maxBytes) {
      callback(new InstagramMediaSafetyError('MEDIA_TOO_LARGE', '媒体下载超过大小限制'))
      return
    }
    callback(null, chunk)
  }
}

/**
 * Production adapter: validates the URL and streams the response to COS. It is
 * never called by the Phase 3 Mock sync path.
 */
export class SafeExternalInstagramMediaLocalizer implements InstagramMediaLocalizer {
  constructor(private readonly options: {
    writer?: MediaUploadWriter
    fetchImpl?: MediaFetch
    lookupImpl?: MediaLookup
    proxyUrl?: string | null
    keyPrefix?: string
    storageMode?: AnywhereDoorStorageMode
    username?: string
    retrySleepImpl?: (milliseconds: number) => Promise<void>
  } = {}) {}

  async localize(media: InstagramMedia, context: { postExternalId: string }) {
    const writer = this.options.writer || createCosMediaUploadWriter()
    const storageMode = this.options.storageMode || getAnywhereDoorStorageMode()
    if (!storageMode) throw new InstagramMediaSafetyError('CONFIG_ERROR', '随意门存储模式无效')
    if (process.env.NODE_ENV === 'production' && storageMode !== 'production') throw new InstagramMediaSafetyError('CONFIG_ERROR', '生产环境必须使用 production 媒体路径')
    const username = this.options.username || 'mreasonchan'
    const keyPrefix = (this.options.keyPrefix || buildInstagramStoragePrefix(username, storageMode)).replace(/^\/+|\/+$/g, '')
    if (!keyPrefix || keyPrefix.includes('..') || !/^[a-zA-Z0-9_/-]+$/.test(keyPrefix)) throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体归档路径无效')
    if (storageMode === 'production' && /(?:^|\/)poc(?:\/|$)/i.test(keyPrefix)) throw new InstagramMediaSafetyError('CONFIG_ERROR', '生产媒体归档路径禁止使用 poc 前缀')
    if (keyPrefix !== buildInstagramStoragePrefix(username, storageMode)) throw new InstagramMediaSafetyError('CONFIG_ERROR', '媒体归档路径必须由统一 key builder 生成')
    if (!/^[a-zA-Z0-9._:-]{1,191}$/.test(context.postExternalId)) throw new InstagramMediaSafetyError('UNSAFE_URL', '媒体归档标识无效')

    const mediaContext: MediaFailureContext = {
      postExternalId: context.postExternalId,
      mediaType: media.type,
      sortOrder: media.sortOrder,
      stage: 'download',
    }
    const source = await fetchMediaWithValidatedRedirects(media.sourceUrl, {}, this.options, mediaContext)
    let storageUrl: string
    try {
      if (!source.response.ok || !source.response.body) {
        throw createMediaResponseFailure(`媒体请求状态异常: ${source.response.status}`, this.options, source.url.toString(), mediaContext, source.redirects, source.response.status)
      }
      const contentType = source.response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || ''
      if (!contentTypeAllowed(media.type, contentType)) {
        throw withMediaFailureDiagnostics(new InstagramMediaSafetyError('MEDIA_CONTENT_TYPE_INVALID', '媒体 Content-Type 与媒体类型不匹配'), this.options, source.url.toString(), mediaContext, source.redirects, source.response.status)
      }
      const contentLengthHeader = source.response.headers.get('content-length')
      const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : undefined
      if (contentLength !== undefined && contentLength > limitForMedia(media)) {
        throw withMediaFailureDiagnostics(new InstagramMediaSafetyError('MEDIA_TOO_LARGE', '媒体超过大小限制'), this.options, source.url.toString(), mediaContext, source.redirects, source.response.status)
      }

      const sourceStream = Readable.fromWeb(source.response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(new ByteLimitTransform(limitForMedia(media)))
      const body = media.type === 'IMAGE' ? sourceStream.pipe(sharp().webp({ quality: 84 })) : sourceStream
      const key = buildInstagramMediaStorageKey({ username, mode: storageMode, externalId: context.postExternalId, kind: media.type === 'VIDEO' ? 'video' : 'image', sortOrder: media.sortOrder })
      try {
        storageUrl = await writer.upload({ key, body, contentType: media.type === 'VIDEO' ? 'video/mp4' : 'image/webp', contentLength: media.type === 'VIDEO' ? contentLength : undefined })
      } catch (error) {
        if (error instanceof InstagramMediaSafetyError) throw withMediaFailureDiagnostics(error, this.options, source.url.toString(), { ...mediaContext, stage: 'upload' }, source.redirects, source.response.status)
        throw withMediaFailureDiagnostics(error, this.options, source.url.toString(), { ...mediaContext, stage: 'upload' }, source.redirects, source.response.status, 'COS_ERROR')
      }
    } finally {
      await source.close()
    }
    let thumbnailUrl: string | null = null
    if (media.type === 'VIDEO' && media.thumbnailUrl) {
      const thumbnailContext: MediaFailureContext = { ...mediaContext, stage: 'thumbnail' }
      const thumbnail = await fetchMediaWithValidatedRedirects(media.thumbnailUrl, {}, this.options, thumbnailContext)
      try {
        if (!thumbnail.response.ok || !thumbnail.response.body) {
          throw createMediaResponseFailure(`缩略图请求状态异常: ${thumbnail.response.status}`, this.options, thumbnail.url.toString(), thumbnailContext, thumbnail.redirects, thumbnail.response.status)
        }
        const thumbnailType = thumbnail.response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || ''
        if (!contentTypeAllowed('IMAGE', thumbnailType)) {
          throw withMediaFailureDiagnostics(new InstagramMediaSafetyError('MEDIA_CONTENT_TYPE_INVALID', '缩略图 Content-Type 无效'), this.options, thumbnail.url.toString(), thumbnailContext, thumbnail.redirects, thumbnail.response.status)
        }
        const thumbnailStream = Readable.fromWeb(thumbnail.response.body as Parameters<typeof Readable.fromWeb>[0]).pipe(new ByteLimitTransform(limitForMedia({ type: 'IMAGE' }))).pipe(sharp().webp({ quality: 82 }))
        const key = buildInstagramMediaStorageKey({ username, mode: storageMode, externalId: context.postExternalId, kind: 'thumbnail', sortOrder: media.sortOrder })
        try {
          thumbnailUrl = await writer.upload({ key, body: thumbnailStream, contentType: 'image/webp' })
        } catch (error) {
          if (error instanceof InstagramMediaSafetyError) throw withMediaFailureDiagnostics(error, this.options, thumbnail.url.toString(), { ...thumbnailContext, stage: 'upload' }, thumbnail.redirects, thumbnail.response.status)
          throw withMediaFailureDiagnostics(error, this.options, thumbnail.url.toString(), { ...thumbnailContext, stage: 'upload' }, thumbnail.redirects, thumbnail.response.status, 'COS_ERROR')
        }
      } finally {
        await thumbnail.close()
      }
    }
    return {
      storageUrl,
      thumbnailUrl,
      width: media.width,
      height: media.height,
      durationMs: media.duration === null ? null : Math.round(media.duration * 1000),
    }
  }
}
