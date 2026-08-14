import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  clearIpLocationCacheForTests,
  normalizeIpLocationProviderResponse,
  normalizeIpRegionFromGeo,
  resolveIpLocation,
} from '../lib/ip-region'
import { getClientIp, getClientIpDiagnostics } from '../lib/client-ip'
import {
  LOCATION_COUNTRIES,
  formatUserLocation,
  getLocationRegions,
  normalizeUserLocationInput,
  searchAllLocationRegions,
  searchLocationCountries,
} from '../lib/user-location'

const read = (path: string) => readFileSync(path, 'utf8')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260814130000_add_ip_regions_and_profile_locations/migration.sql')
const postMigration = read('prisma/migrations/20260814170000_add_post_ip_region/migration.sql')
const ipResolver = read('lib/ip-region.ts')
const profileApi = read('app/api/users/me/route.ts')
const profileSurface = read('components/ProfilePageSurface.tsx')
const profilePage = read('app/profile/page.tsx')
const profileForm = read('app/profile/ProfileSettingsForm.tsx')
const postCreateApi = read('app/api/posts/route.ts')
const replyCreateApi = read('app/api/posts/[postId]/replies/route.ts')
const postDetailPage = read('app/posts/[postId]/page.tsx')
const forumFeed = read('app/api/forum/feed/route.ts')
const forumDiscovery = read('app/api/forum/discover/route.ts')
const replies = read('components/PostRepliesSection.tsx')
const checkinMessages = read('components/CheckInMessagesPanel.tsx')
const wall = read('components/ProfileWall.tsx')

test('IP 属地只输出粗粒度标准化名称，不包含城市或完整 IP', () => {
  assert.equal(normalizeIpRegionFromGeo({ country: 'CN', regionCode: 'CN-44' }), '广东')
  assert.equal(normalizeIpRegionFromGeo({ country: 'CN', region: '广西壮族自治区' }), '广西')
  assert.equal(normalizeIpRegionFromGeo({ country: 'CN', region: '北京市' }), '北京')
  assert.equal(normalizeIpRegionFromGeo({ country: 'HK', region: '九龙' }), '中国香港')
  assert.equal(normalizeIpRegionFromGeo({ country: 'JP', region: 'Tokyo' }), '日本')
  assert.equal(normalizeIpRegionFromGeo({ country: 'US', region: 'California' }), '美国')
  assert.equal(normalizeIpRegionFromGeo({ country: 'ZZ', region: 'Somewhere' }), null)
  assert.equal(normalizeIpRegionFromGeo({}), null)
  assert.match(ipResolver, /resolveIpLocation\(request: Request\)/)
  assert.match(ipResolver, /getClientIp\(request\)/)
  assert.match(ipResolver, /IP_LOCATION_API_URL/)
  assert.doesNotMatch(ipResolver, /\|\| '广东'/)
  assert.match(ipResolver, /getCloudflareContext\(\{ async: true \}\)/)
  assert.match(ipResolver, /TRUSTED_EDGE_GEO_HEADERS/)
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'CN', region_code: '44', org: 'test' })?.label, '广东')
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'CN', region: '广西壮族自治区' })?.label, '广西')
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'CN', region: 'Zhejiang' })?.label, '浙江')
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'JP' })?.label, '日本')
  assert.equal(normalizeIpLocationProviderResponse({ success: false }), null)
})

test('只信任 Nginx 重写的客户端 IP，并按 IP 分别缓存 IPv4/IPv6 解析结果', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  const previousDiagnostics = process.env.IP_DIAGNOSTICS_LOG
  let providerCalls = 0

  process.env.IP_LOCATION_API_URL = 'https://unit.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  process.env.IP_DIAGNOSTICS_LOG = 'false'
  clearIpLocationCacheForTests()
  globalThis.fetch = async () => {
    providerCalls += 1
    const regionCode = providerCalls === 1 ? '44' : '33'
    return new Response(JSON.stringify({ country_code: 'CN', region_code: regionCode }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const guangdongRequest = new Request('https://ecfc.fans/api/posts', {
      headers: {
        'x-ecfc-client-ip': '203.0.113.10',
        'x-real-ip': '1.1.1.1',
        'x-forwarded-for': '9.9.9.9',
      },
    })
    const zhejiangRequest = new Request('https://ecfc.fans/api/posts', {
      headers: { 'x-ecfc-client-ip': '2409:8a00:1234::10' },
    })
    const forgedRequest = new Request('https://ecfc.fans/api/posts', {
      headers: { 'x-forwarded-for': '203.0.113.99', 'x-real-ip': '203.0.113.98' },
    })

    assert.equal(getClientIp(guangdongRequest), '203.0.113.10')
    assert.equal(getClientIp(forgedRequest), 'unknown')
    assert.equal((await resolveIpLocation(guangdongRequest))?.label, '广东')
    assert.equal((await resolveIpLocation(zhejiangRequest))?.label, '浙江')
    assert.equal((await resolveIpLocation(guangdongRequest))?.label, '广东')
    assert.equal(providerCalls, 2)
  } finally {
    globalThis.fetch = originalFetch
    clearIpLocationCacheForTests()
    if (previousApiUrl === undefined) delete process.env.IP_LOCATION_API_URL
    else process.env.IP_LOCATION_API_URL = previousApiUrl
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
    if (previousDiagnostics === undefined) delete process.env.IP_DIAGNOSTICS_LOG
    else process.env.IP_DIAGNOSTICS_LOG = previousDiagnostics
  }
})

test('trusted proxy modes resolve CF, forwarded, mapped, and invalid addresses safely', () => {
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  try {
    process.env.TRUSTED_CLIENT_IP_SOURCE = 'cloudflare'
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'cf-connecting-ip': '203.0.113.20' } })), '203.0.113.20')

    process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx-forwarded'
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-forwarded-for': '203.0.113.21' } })), '203.0.113.21')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-forwarded-for': '10.0.0.1, ::ffff:203.0.113.22, 203.0.113.23' } })), '203.0.113.22')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-real-ip': '203.0.113.24' } })), '203.0.113.24')

    process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-ecfc-client-ip': '::ffff:203.0.113.25' } })), '203.0.113.25')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-ecfc-client-ip': '10.0.0.1', 'x-real-ip': '203.0.113.26' } })), 'unknown')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-forwarded-for': '203.0.113.27' } })), 'unknown')
  } finally {
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
  }
})

test('IP location provider failure returns null instead of a province fallback', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  process.env.IP_LOCATION_API_URL = 'https://unit.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  clearIpLocationCacheForTests()
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'fail' }), { status: 200 })
  try {
    const location = await resolveIpLocation(new Request('https://ecfc.fans/api/posts', {
      headers: { 'x-ecfc-client-ip': '203.0.113.28' },
    }))
    assert.equal(location, null)
  } finally {
    globalThis.fetch = originalFetch
    clearIpLocationCacheForTests()
    if (previousApiUrl === undefined) delete process.env.IP_LOCATION_API_URL
    else process.env.IP_LOCATION_API_URL = previousApiUrl
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
  }
})

test('诊断日志只包含约定的五个 IP 字段并限制 Header 长度', () => {
  const forwardedFor = `203.0.113.22${'x'.repeat(600)}`
  const request = new Request('https://ecfc.fans/api/posts', {
    headers: {
      'cf-connecting-ip': '203.0.113.20',
      'x-real-ip': '203.0.113.21',
      'x-forwarded-for': forwardedFor,
      'x-ecfc-remote-address': '203.0.113.23',
    },
  })
  assert.deepEqual(getClientIpDiagnostics(request, '203.0.113.24'), {
    cfConnectingIp: '203.0.113.20',
    xRealIp: '203.0.113.21',
    xForwardedFor: forwardedFor.slice(0, 512),
    remoteAddress: '203.0.113.23',
    resolvedClientIp: '203.0.113.24',
  })
})

test('数据库只保存 nullable 的处理后属地，旧记录无需回填', () => {
  for (const model of ['CultureComment', 'DailyMessage', 'DailyMessageComment', 'ProfileWallMessage', 'Reply', 'Post']) {
    assert.match(schema, new RegExp(`model ${model} \\{[\\s\\S]*?ipRegion\\s+String\\?`))
  }
  assert.match(schema, /ipRegionUpdatedAt\s+DateTime\?/)
  assert.match(migration, /ADD COLUMN `ipRegion` VARCHAR\(191\) NULL/)
  assert.match(migration, /ADD COLUMN `ipRegionUpdatedAt` DATETIME\(3\) NULL/)
  assert.doesNotMatch(profileApi, /rawIp|clientIp|forwardedFor/)
})

test('用户自定义地区使用全球国家列表与结构化一级地区', () => {
  assert.ok(LOCATION_COUNTRIES.length > 200)
  assert.ok(searchLocationCountries('日本').some((item) => item.code === 'JP'))
  assert.ok(searchAllLocationRegions('东京').some((item) => item.country.code === 'JP' && item.region.code === 'JP-13'))
  assert.ok(getLocationRegions('US').some((item) => item.code === 'US-CA'))
  assert.deepEqual(normalizeUserLocationInput({ countryCode: 'JP', regionCode: 'JP-13', countryName: '美国', regionName: '伪造' }), {
    countryCode: 'JP',
    countryName: '日本',
    regionCode: 'JP-13',
    regionName: '东京都',
  })
  assert.equal(normalizeUserLocationInput({ countryCode: 'JP', regionCode: 'not-real' }), undefined)
  assert.equal(normalizeUserLocationInput(null), null)
  assert.equal(formatUserLocation({ countryCode: 'JP', countryName: '日本', regionCode: 'JP-13', regionName: '东京都' }), '日本 · 东京都')
  assert.match(profileApi, /normalizeUserLocationInput/)
  assert.match(profileApi, /locationCountryCode/)
  assert.match(profileForm, /UserLocationPicker/)
  assert.match(profileForm, /location: form\.location/)
  assert.match(profileForm, /与系统显示的 IP 属地无关/)
})

test('个人档案与所有主要公开评论链路区分显示两个地区概念', () => {
  assert.match(profileSurface, /地区/)
  assert.match(profileSurface, /IP属地/)
  assert.match(replies, /IpRegionLabel ipRegion=\{reply\.ipRegion\}/)
  assert.match(checkinMessages, /IpRegionLabel ipRegion=\{item\.ipRegion\}/)
  assert.match(checkinMessages, /IpRegionLabel ipRegion=\{comment\.ipRegion\}/)
  assert.match(wall, /IpRegionLabel ipRegion=\{message\.ipRegion\}/)
  assert.match(profileSurface, /formatUserLocation\(profile\.location\) \|\|/)
  assert.match(profileSurface, /profile\.ipRegion \|\|/)
  assert.doesNotMatch(profileSurface, /profile\.location\s*\?\s*profile\.ipRegion/)
  assert.match(profilePage, /updateUserIpRegion/)
})

test('帖子保存发表时的独立省级 IP 属地并在广场、发现页和详情展示', () => {
  assert.match(postCreateApi, /resolveIpLocation\(request\)/)
  assert.match(postCreateApi, /content: input\.content,\s*ipRegion,\s*summary:/)
  assert.match(replyCreateApi, /resolveIpLocation\(request\)/)
  assert.match(replyCreateApi, /content,\s*ipRegion,[\s\S]*parentId:/)
  assert.match(postDetailPage, /IpRegionLabel ipRegion=\{post\.ipRegion\}/)
  assert.match(forumFeed, /ipRegion: true/)
  assert.match(forumDiscovery, /ipRegion: true/)
  assert.match(postMigration, /ALTER TABLE `Post`[\s\S]*ADD COLUMN `ipRegion` VARCHAR\(191\) NULL/)
})
