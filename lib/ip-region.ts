import { getCloudflareContext } from '@opennextjs/cloudflare'
import { prisma } from '@/lib/prisma'
import {
  getClientIp,
  getClientIpResolution,
  type IpHeaderSource,
} from '@/lib/client-ip'

type EdgeGeo = {
  country?: unknown
  countryCode?: unknown
  countryName?: unknown
  region?: unknown
  regionCode?: unknown
  isp?: unknown
}

export type IpLocation = {
  countryCode: string
  province: string | null
  isp: string | null
  label: string
}

const chinaRegions: Record<string, string> = {
  '11': '北京',
  '12': '天津',
  '13': '河北',
  '14': '山西',
  '15': '内蒙古',
  '21': '辽宁',
  '22': '吉林',
  '23': '黑龙江',
  '31': '上海',
  '32': '江苏',
  '33': '浙江',
  '34': '安徽',
  '35': '福建',
  '36': '江西',
  '37': '山东',
  '41': '河南',
  '42': '湖北',
  '43': '湖南',
  '44': '广东',
  '45': '广西',
  '46': '海南',
  '50': '重庆',
  '51': '四川',
  '52': '贵州',
  '53': '云南',
  '54': '西藏',
  '61': '陕西',
  '62': '甘肃',
  '63': '青海',
  '64': '宁夏',
  '65': '新疆',
  // ISO 3166-2 subdivision suffixes used by several IP providers.
  BJ: '北京',
  TJ: '天津',
  HE: '河北',
  SX: '山西',
  NM: '内蒙古',
  LN: '辽宁',
  JL: '吉林',
  HL: '黑龙江',
  SH: '上海',
  JS: '江苏',
  ZJ: '浙江',
  AH: '安徽',
  FJ: '福建',
  JX: '江西',
  SD: '山东',
  HA: '河南',
  HB: '湖北',
  HN: '湖南',
  GD: '广东',
  GX: '广西',
  HI: '海南',
  CQ: '重庆',
  SC: '四川',
  GZ: '贵州',
  YN: '云南',
  XZ: '西藏',
  SN: '陕西',
  GS: '甘肃',
  QH: '青海',
  NX: '宁夏',
  XJ: '新疆',
}

const chinaRegionAliases: Record<string, string> = {
  北京市: '北京',
  天津市: '天津',
  河北省: '河北',
  山西省: '山西',
  内蒙古自治区: '内蒙古',
  辽宁省: '辽宁',
  吉林省: '吉林',
  黑龙江省: '黑龙江',
  上海市: '上海',
  江苏省: '江苏',
  浙江省: '浙江',
  安徽省: '安徽',
  福建省: '福建',
  江西省: '江西',
  山东省: '山东',
  河南省: '河南',
  湖北省: '湖北',
  湖南省: '湖南',
  广东省: '广东',
  广西壮族自治区: '广西',
  海南省: '海南',
  重庆市: '重庆',
  四川省: '四川',
  贵州省: '贵州',
  云南省: '云南',
  西藏自治区: '西藏',
  陕西省: '陕西',
  甘肃省: '甘肃',
  青海省: '青海',
  宁夏回族自治区: '宁夏',
  新疆维吾尔自治区: '新疆',
  Beijing: '北京',
  Tianjin: '天津',
  Hebei: '河北',
  Shanxi: '山西',
  InnerMongolia: '内蒙古',
  Liaoning: '辽宁',
  Jilin: '吉林',
  Heilongjiang: '黑龙江',
  Shanghai: '上海',
  Jiangsu: '江苏',
  Zhejiang: '浙江',
  Anhui: '安徽',
  Fujian: '福建',
  Jiangxi: '江西',
  Shandong: '山东',
  Henan: '河南',
  Hubei: '湖北',
  Hunan: '湖南',
  Guangdong: '广东',
  Guangxi: '广西',
  Hainan: '海南',
  Chongqing: '重庆',
  Sichuan: '四川',
  Guizhou: '贵州',
  Yunnan: '云南',
  Tibet: '西藏',
  Shaanxi: '陕西',
  Gansu: '甘肃',
  Qinghai: '青海',
  Ningxia: '宁夏',
  Xinjiang: '新疆',
}

const countryAliases: Record<string, string> = {
  CN: 'CN',
  CHN: 'CN',
  中国: 'CN',
  China: 'CN',
  HK: 'HK',
  HKG: 'HK',
  香港: 'HK',
  中国香港: 'HK',
  MO: 'MO',
  MAC: 'MO',
  澳门: 'MO',
  中国澳门: 'MO',
  TW: 'TW',
  TWN: 'TW',
  台湾: 'TW',
  中国台湾: 'TW',
}

const countryNameOverrides: Record<string, string> = {
  CN: '中国',
  HK: '中国香港',
  MO: '中国澳门',
  TW: '中国台湾',
  JP: '日本',
  KR: '韩国',
  SG: '新加坡',
  MY: '马来西亚',
  TH: '泰国',
  GB: '英国',
  US: '美国',
  CA: '加拿大',
  AU: '澳大利亚',
  FR: '法国',
  DE: '德国',
  ES: '西班牙',
  IT: '意大利',
  RU: '俄罗斯',
  IN: '印度',
  BR: '巴西',
}

const DEFAULT_IP_LOCATION_API_URL = 'https://ipapi.co/{ip}/json/'
const DEFAULT_IP_LOCATION_TIMEOUT_MS = 2500
const DEFAULT_IP_LOCATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const FAILED_IP_LOCATION_CACHE_TTL_MS = 60 * 1000
const MAX_IP_LOCATION_CACHE_ENTRIES = 2000

type LocationCacheEntry = {
  expiresAt: number
  value: IpLocation | null
  lookupResult: IpLookupResult
  provider: string | null
}

type IpLookupResult =
  | 'success'
  | 'timeout'
  | 'provider-error'
  | 'unknown-region'

const ipLocationCache = new Map<string, LocationCacheEntry>()
type LocationLookup = {
  location: IpLocation | null
  lookupResult: IpLookupResult
  provider: string | null
  cacheHit: boolean
}

const ipLocationInFlight = new Map<string, Promise<LocationLookup>>()

function stringValue(value: unknown) {
  if (typeof value === 'string') return value.trim()
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function compact(value: string) {
  return value.replace(/[\s._-]+/g, '').toLowerCase()
}

function canonicalCountryCode(value: unknown) {
  const raw = stringValue(value)
  if (!raw) return ''
  return countryAliases[raw] || raw.toUpperCase()
}

function canonicalChinaRegion(value: unknown) {
  const raw = stringValue(value)
  if (!raw) return null
  const code = raw.toUpperCase().replace(/^CN[-_]/, '')
  if (chinaRegions[code]) return chinaRegions[code]
  if (chinaRegionAliases[raw]) return chinaRegionAliases[raw]
  const normalized = compact(raw)
  const alias = Object.entries(chinaRegionAliases).find(([key]) => compact(key) === normalized)
  if (alias?.[1]) return alias[1]

  const englishCodes: Record<string, string> = {
    beijing: 'BJ',
    tianjin: 'TJ',
    hebei: 'HE',
    shanxi: 'SX',
    innermongolia: 'NM',
    liaoning: 'LN',
    jilin: 'JL',
    heilongjiang: 'HL',
    shanghai: 'SH',
    jiangsu: 'JS',
    zhejiang: 'ZJ',
    anhui: 'AH',
    fujian: 'FJ',
    jiangxi: 'JX',
    shandong: 'SD',
    henan: 'HA',
    hubei: 'HB',
    hunan: 'HN',
    guangdong: 'GD',
    guangxi: 'GX',
    hainan: 'HI',
    chongqing: 'CQ',
    sichuan: 'SC',
    guizhou: 'GZ',
    yunnan: 'YN',
    tibet: 'XZ',
    xizang: 'XZ',
    shaanxi: 'SN',
    gansu: 'GS',
    qinghai: 'QH',
    ningxia: 'NX',
    xinjiang: 'XJ',
  }
  const englishBase = normalized
    .replace(/(?:province|sheng|autonomousregion|zhuangzuzizhiqu|huizuzizhiqu|wewuerzizhiqu|zizhiqu)$/i, '')
  const englishCode = englishCodes[englishBase]
  if (englishCode && chinaRegions[englishCode]) return chinaRegions[englishCode]

  const chineseBase = raw.replace(/(?:\u7701|\u5e02|\u81ea\u6cbb\u533a|\u7279\u522b\u884c\u653f\u533a)$/u, '')
  const chineseMatch = Object.values(chinaRegions).find((region) => region === chineseBase)
  return chineseMatch || null
}

function countryName(country: string) {
  if (country === 'HK') return '\u9999\u6e2f'
  if (country === 'MO') return '\u6fb3\u95e8'
  if (country === 'TW') return '\u53f0\u6e7e'
  if (countryNameOverrides[country]) return countryNameOverrides[country]
  try {
    const value = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(country)
    if (!value || value === '未知地区' || value.toLocaleLowerCase() === 'unknown region') return null
    return value
  } catch {
    return null
  }
}

function normalizeLocation(input: EdgeGeo | null | undefined): IpLocation | null {
  if (!input) return null
  const country = canonicalCountryCode(input.countryCode || input.country)
  if (!country) return null

  const province = country === 'CN'
    ? canonicalChinaRegion(input.regionCode) || canonicalChinaRegion(input.region)
    : null
  const label = country === 'CN' ? province : countryName(country)
  if (!label) return null

  return {
    countryCode: country,
    province,
    isp: stringValue(input.isp) || null,
    label,
  }
}

/**
 * Normalize trusted edge metadata to the deliberately coarse public label.
 * No IP address is returned or persisted by this function.
 */
export function normalizeIpLocationFromGeo(input: EdgeGeo | null | undefined) {
  return normalizeLocation(input)
}

export function normalizeIpRegionFromGeo(input: EdgeGeo | null | undefined) {
  return normalizeLocation(input)?.label || null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readStringField(source: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = stringValue(source[key])
    if (value) return value
  }
  return ''
}

/**
 * Accept the common response shapes used by IP geolocation providers. The
 * provider response is reduced to country/province/ISP before it reaches any
 * route or database write.
 */
export function normalizeIpLocationProviderResponse(payload: unknown): IpLocation | null {
  if (!isRecord(payload)) return null
  if (payload.success === false || payload.status === 'fail' || payload.error === true) return null

  const source = isRecord(payload.data) ? payload.data : payload
  if (source.success === false || source.status === 'fail' || source.error === true) return null

  const connection = isRecord(source.connection) ? source.connection : null
  return normalizeLocation({
    country: readStringField(source, ['country_code', 'countryCode', 'country']),
    countryCode: readStringField(source, ['country_code', 'countryCode']),
    countryName: readStringField(source, ['country_name', 'countryName']),
    regionCode: readStringField(source, ['region_code', 'regionCode', 'province_code', 'provinceCode']),
    region: readStringField(source, ['region', 'regionName', 'region_name', 'province', 'provinceName', 'province_name']),
    isp: readStringField(source, ['isp', 'org', 'organization'])
      || (connection ? readStringField(connection, ['isp', 'org', 'organization']) : ''),
  })
}

type CloudflareGeoContextReader = () => Promise<EdgeGeo | null>

// In a real Cloudflare Workers/OpenNext deployment the worker entrypoint
// populates the request's cf metadata from the actual client. Under PM2 +
// Nginx the @opennextjs/cloudflare adapter can still synthesize a cf object
// (via wrangler/getPlatformProxy, cached on the global scope) that is NOT
// derived from the current request's client IP — so it must never be
// auto-enabled. It is gated behind TRUSTED_CLOUDFLARE_GEO_CONTEXT and is fully
// decoupled from which client-IP header is trusted.
async function defaultCloudflareGeoContextReader(): Promise<EdgeGeo | null> {
  try {
    const context = await getCloudflareContext({ async: true })
    if (!context.cf) return null
    return {
      country: context.cf.country,
      region: context.cf.region,
      regionCode: context.cf.regionCode,
    }
  } catch {
    return null
  }
}

let cloudflareGeoContextReader: CloudflareGeoContextReader = defaultCloudflareGeoContextReader

async function readCloudflareGeo(): Promise<EdgeGeo | null> {
  return cloudflareGeoContextReader()
}

export function setCloudflareGeoContextReaderForTests(
  reader: CloudflareGeoContextReader | null,
) {
  cloudflareGeoContextReader = reader ?? defaultCloudflareGeoContextReader
}

function readTrustedEdgeGeo(request: Request): IpLocation | null {
  if (process.env.TRUSTED_EDGE_GEO_HEADERS !== 'true') return null
  return normalizeLocation({
    country: request.headers.get('x-ecfc-geo-country'),
    region: request.headers.get('x-ecfc-geo-region'),
    regionCode: request.headers.get('x-ecfc-geo-region-code'),
  })
}

function timeoutMs() {
  const value = Number(process.env.IP_LOCATION_TIMEOUT_MS)
  return Number.isInteger(value) && value >= 500 && value <= 10_000
    ? value
    : DEFAULT_IP_LOCATION_TIMEOUT_MS
}

function cloudflareGeoContextEnabled() {
  return process.env.TRUSTED_CLOUDFLARE_GEO_CONTEXT === 'true'
}

// Primary provider first, then an optional fallback provider. Both must contain
// the {ip} placeholder. No fallback URL configured ⇒ a primary failure returns
// null (never a province fallback).
function configuredApiUrlTemplates(): string[] {
  const templates: string[] = []
  const primary = (process.env.IP_LOCATION_API_URL || DEFAULT_IP_LOCATION_API_URL).trim()
  if (primary.includes('{ip}')) {
    templates.push(primary)
  } else {
    console.error('[ip-location.config]', { reason: 'missing_ip_placeholder' })
  }
  const fallback = process.env.IP_LOCATION_FALLBACK_API_URL?.trim()
  if (fallback && fallback.includes('{ip}')) templates.push(fallback)
  return templates
}

function buildProviderUrl(template: string, ip: string) {
  return template.replaceAll('{ip}', encodeURIComponent(ip))
}

function providerLabel(template: string) {
  try {
    return new URL(template.replace('{ip}', '0.0.0.0')).origin
  } catch {
    return 'unknown'
  }
}

function cacheTtlMs(value: IpLocation | null) {
  if (!value) return FAILED_IP_LOCATION_CACHE_TTL_MS
  const configuredSeconds = Number(process.env.IP_LOCATION_CACHE_TTL_SECONDS)
  if (Number.isInteger(configuredSeconds) && configuredSeconds >= 60 && configuredSeconds <= 7 * 24 * 60 * 60) {
    return configuredSeconds * 1000
  }
  return DEFAULT_IP_LOCATION_CACHE_TTL_MS
}

function cacheLocation(
  ip: string,
  value: IpLocation | null,
  lookupResult: IpLookupResult,
  provider: string | null,
) {
  if (ipLocationCache.size >= MAX_IP_LOCATION_CACHE_ENTRIES) {
    const oldestKey = ipLocationCache.keys().next().value
    if (oldestKey) ipLocationCache.delete(oldestKey)
  }
  ipLocationCache.set(ip, {
    expiresAt: Date.now() + cacheTtlMs(value),
    value,
    lookupResult,
    provider,
  })
}

async function fetchOneProvider(
  url: string,
  label: string,
): Promise<{ location: IpLocation | null; lookupResult: IpLookupResult }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs())
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'eason-fans-club/ip-location',
    }
    const apiKey = process.env.IP_LOCATION_API_KEY?.trim()
    if (apiKey) headers['X-API-Key'] = apiKey

    const response = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: controller.signal,
    })
    if (response.status === 429) {
      console.warn('[ip-location.provider]', { provider: label, status: 429, reason: 'rate_limited' })
      return { location: null, lookupResult: 'provider-error' }
    }
    if (!response.ok) {
      console.warn('[ip-location.provider]', { provider: label, status: response.status, reason: 'http_error' })
      return { location: null, lookupResult: 'provider-error' }
    }
    const payload = await response.json().catch(() => null)
    const location = normalizeIpLocationProviderResponse(payload)
    if (!location) {
      console.warn('[ip-location.provider]', { provider: label, status: response.status, reason: 'invalid_response' })
      return { location: null, lookupResult: 'unknown-region' }
    }
    return { location, lookupResult: 'success' }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'request_error'
    console.warn('[ip-location.provider]', { provider: label, reason })
    return {
      location: null,
      lookupResult: reason === 'timeout' ? 'timeout' : 'provider-error',
    }
  } finally {
    clearTimeout(timeout)
  }
}

// Try the primary provider, then the optional fallback. The first success wins;
// every failure mode (429, timeout, http error, invalid response) falls through
// to the next provider, and an exhaustive failure returns null — never a
// province fallback.
async function fetchIpLocation(ip: string): Promise<LocationLookup> {
  const templates = configuredApiUrlTemplates()
  if (!templates.length) {
    return { location: null, lookupResult: 'provider-error', provider: null, cacheHit: false }
  }

  let lastResult: IpLookupResult = 'provider-error'
  let lastProvider: string | null = null
  for (const template of templates) {
    const label = providerLabel(template)
    lastProvider = label
    const result = await fetchOneProvider(buildProviderUrl(template, ip), label)
    if (result.location) {
      return { location: result.location, lookupResult: 'success', provider: label, cacheHit: false }
    }
    lastResult = result.lookupResult
  }
  return { location: null, lookupResult: lastResult, provider: lastProvider, cacheHit: false }
}

async function lookupIpLocation(ip: string): Promise<LocationLookup> {
  const cached = ipLocationCache.get(ip)
  if (cached) {
    if (cached.expiresAt > Date.now()) {
      return {
        location: cached.value,
        lookupResult: cached.lookupResult,
        provider: cached.provider,
        cacheHit: true,
      }
    }
    ipLocationCache.delete(ip)
  }

  const inFlight = ipLocationInFlight.get(ip)
  if (inFlight) return inFlight

  const request = fetchIpLocation(ip).then((lookup) => {
    cacheLocation(ip, lookup.location, lookup.lookupResult, lookup.provider)
    return lookup
  }).finally(() => {
    ipLocationInFlight.delete(ip)
  })
  ipLocationInFlight.set(ip, request)
  return request
}

type IpLocationDiagnostics = {
  clientIpSource: string
  geoSource: 'cloudflare-context' | 'trusted-edge' | 'provider' | 'none'
  lookupResult: string
  provider: string | null
  cacheHit: boolean
}

function logIpLocationDiagnostics(diagnostics: IpLocationDiagnostics) {
  if (process.env.IP_DIAGNOSTICS_LOG !== 'true' && process.env.DEBUG_CLIENT_IP !== 'true') return
  console.info('[ip-location.diagnostics]', diagnostics)
}

/**
 * Resolve one request's location. The authoritative client IP is obtained once
 * from the trusted proxy contract, then the location lookup is cached by that
 * exact IP. A failed/unknown lookup returns null; it never becomes a province
 * fallback.
 *
 * Which client-IP header is trusted (TRUSTED_CLIENT_IP_SOURCE) is decoupled from
 * where Geo metadata comes from. Cloudflare request-context geo is only
 * consulted under the separate, explicit TRUSTED_CLOUDFLARE_GEO_CONTEXT switch
 * (default off) — it must never be auto-enabled by trusting a Cloudflare IP
 * header, because under PM2 + Nginx the cf object is not bound to the real
 * client IP and would pin every user to one shared region.
 */
export async function resolveIpLocation(request: Request): Promise<IpLocation | null> {
  const clientIpResolution = getClientIpResolution(request)
  const clientIp = clientIpResolution.ip

  if (cloudflareGeoContextEnabled()) {
    const cloudflareLocation = normalizeLocation(await readCloudflareGeo())
    if (cloudflareLocation) {
      logIpLocationDiagnostics({
        clientIpSource: clientIpResolution.source,
        geoSource: 'cloudflare-context',
        lookupResult: 'success',
        provider: null,
        cacheHit: false,
      })
      return cloudflareLocation
    }
  }

  const trustedEdgeLocation = readTrustedEdgeGeo(request)
  if (trustedEdgeLocation) {
    logIpLocationDiagnostics({
      clientIpSource: clientIpResolution.source,
      geoSource: 'trusted-edge',
      lookupResult: 'success',
      provider: null,
      cacheHit: false,
    })
    return trustedEdgeLocation
  }

  if (clientIpResolution.status !== 'success' || clientIp === 'unknown') {
    logIpLocationDiagnostics({
      clientIpSource: clientIpResolution.source,
      geoSource: 'none',
      lookupResult: clientIpResolution.status,
      provider: null,
      cacheHit: false,
    })
    return null
  }

  const lookup = await lookupIpLocation(clientIp)
  logIpLocationDiagnostics({
    clientIpSource: clientIpResolution.source,
    geoSource: lookup.location ? 'provider' : 'none',
    lookupResult: lookup.lookupResult,
    provider: lookup.provider,
    cacheHit: lookup.cacheHit,
  })
  return lookup.location
}

function isRequest(value: Request | IpLocation | null): value is Request {
  if (!value || typeof value !== 'object') return false
  return 'headers' in value
}

export async function updateUserIpRegion(userId: string, source: Request | IpLocation | null) {
  const location = isRequest(source)
    ? await resolveIpLocation(source)
    : source
  const region = location?.label || null

  try {
    await prisma.user.updateMany({
      where: { id: userId },
      data: { ipRegion: region, ipRegionUpdatedAt: new Date() },
    })
  } catch (error) {
    // IP metadata is optional and must never block the primary user action.
    console.error('[ip-region.update]', error)
  }

  return region
}

export function clearIpLocationCacheForTests() {
  ipLocationCache.clear()
  ipLocationInFlight.clear()
}

// Kept as a narrow compatibility export for older callers outside this app.
export { getClientIp }
export type { IpHeaderSource }
