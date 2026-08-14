import { getCloudflareContext } from '@opennextjs/cloudflare'
import { prisma } from '@/lib/prisma'

type EdgeGeo = {
  country?: unknown
  region?: unknown
  regionCode?: unknown
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
  '中国香港': 'HK',
  MO: 'MO',
  MAC: 'MO',
  澳门: 'MO',
  '中国澳门': 'MO',
  TW: 'TW',
  TWN: 'TW',
  台湾: 'TW',
  '中国台湾': 'TW',
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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
  const code = raw.toUpperCase().replace(/^CN-/, '')
  if (chinaRegions[code]) return chinaRegions[code]
  if (chinaRegionAliases[raw]) return chinaRegionAliases[raw]
  const normalized = compact(raw)
  const alias = Object.entries(chinaRegionAliases).find(([key]) => compact(key) === normalized)
  return alias?.[1] || null
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

function countryName(country: string) {
  if (countryNameOverrides[country]) return countryNameOverrides[country]
  try {
    const value = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(country)
    if (!value || value === '未知地区' || value.toLocaleLowerCase() === 'unknown region') return null
    return value
  } catch {
    return null
  }
}

/**
 * Convert an edge-provided country/region pair to the intentionally coarse
 * public label. The input never contains a client IP and the return value is
 * the only location value persisted or sent to the browser.
 */
export function normalizeIpRegionFromGeo(input: EdgeGeo | null | undefined) {
  if (!input) return null
  const country = canonicalCountryCode(input.country)
  if (!country) return null

  if (country === 'CN') {
    return canonicalChinaRegion(input.regionCode) || canonicalChinaRegion(input.region) || '中国'
  }
  if (country === 'HK' || country === 'MO' || country === 'TW') return countryName(country)
  return countryName(country)
}

async function readCloudflareGeo(): Promise<EdgeGeo | null> {
  try {
    const context = await getCloudflareContext({ async: true })
    if (!context.cf) return null
    return {
      country: context.cf.country,
      region: context.cf.region,
      regionCode: context.cf.regionCode,
    }
  } catch {
    // The local Next.js runtime has no Cloudflare request context. This is a
    // normal development path and must not make a comment or profile request
    // fail.
    return null
  }
}

/**
 * Resolve the request's coarse region from trusted deployment metadata.
 * Production runs behind Cloudflare, whose request.cf object is attached at
 * the edge and cannot be supplied by a browser header. Raw X-Forwarded-For,
 * X-Real-IP and CF-Connecting-IP are deliberately not used here.
 *
 * A non-Cloudflare deployment may opt into geo-only headers written by its
 * trusted edge proxy. The proxy must strip and rewrite these headers before
 * forwarding the request; the default is disabled.
 */
export async function resolveIpRegion(request: Request) {
  const cloudflareRegion = normalizeIpRegionFromGeo(await readCloudflareGeo())
  if (cloudflareRegion) return cloudflareRegion

  if (process.env.TRUSTED_EDGE_GEO_HEADERS !== 'true') return null
  return normalizeIpRegionFromGeo({
    country: request.headers.get('x-ecfc-geo-country'),
    region: request.headers.get('x-ecfc-geo-region'),
    regionCode: request.headers.get('x-ecfc-geo-region-code'),
  })
}

export async function updateUserIpRegion(userId: string, source: Request | string | null) {
  const region = typeof source === 'string' || source === null ? source : await resolveIpRegion(source)
  if (!region) return null

  try {
    await prisma.user.updateMany({
      where: {
        id: userId,
        OR: [
          { ipRegion: null },
          { ipRegion: { not: region } },
        ],
      },
      data: { ipRegion: region, ipRegionUpdatedAt: new Date() },
    })
  } catch (error) {
    // IP metadata is an optional supplement. A database/schema rollout or
    // edge metadata issue must never block the primary user action.
    console.error('[ip-region.update]', error)
  }

  return region
}
