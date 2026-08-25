import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  clearIpLocationCacheForTests,
  normalizeIpLocationProviderResponse,
  normalizeIpRegionFromGeo,
  resolveIpLocation,
  setCloudflareGeoContextReaderForTests,
} from '../lib/ip-region'
import {
  getClientIp,
  getClientIpDiagnostics,
  getClientIpResolution,
  isPublicIp,
  normalizeIp,
} from '../lib/client-ip'
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
const productionEntry = read('.github/workflows/configure-production-entry.yml')
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
const ipRegionLabel = read('components/IpRegionLabel.tsx')

test('IP 属地只输出粗粒度标准化名称，不包含城市或完整 IP', () => {
  assert.equal(normalizeIpRegionFromGeo({ country: 'CN', regionCode: 'CN-44' }), '广东')
  assert.equal(normalizeIpRegionFromGeo({ country: 'CN', region: '广西壮族自治区' }), '广西')
  assert.equal(normalizeIpRegionFromGeo({ country: 'CN', region: '北京市' }), '北京')
  assert.equal(normalizeIpRegionFromGeo({ country: 'HK', region: '九龙' }), '香港')
  assert.equal(normalizeIpRegionFromGeo({ country: 'JP', region: 'Tokyo' }), '日本')
  assert.equal(normalizeIpRegionFromGeo({ country: 'US', region: 'California' }), '美国')
  assert.equal(normalizeIpRegionFromGeo({ country: 'ZZ', region: 'Somewhere' }), null)
  assert.equal(normalizeIpRegionFromGeo({}), null)
  assert.match(ipResolver, /resolveIpLocation\(request: Request\)/)
  assert.match(ipResolver, /getClientIpResolution\(request\)/)
  assert.match(ipResolver, /IP_LOCATION_API_URL/)
  assert.doesNotMatch(ipResolver, /\|\| '广东'/)
  assert.match(ipResolver, /getCloudflareContext\(\{ async: true \}\)/)
  assert.match(ipResolver, /TRUSTED_EDGE_GEO_HEADERS/)
  assert.ok(productionEntry.includes('https://www.cloudflare.com/ips-v4'))
  assert.ok(productionEntry.includes('https://www.cloudflare.com/ips-v6'))
  assert.ok(productionEntry.includes('real_ip_header CF-Connecting-IP;'))
  assert.ok(productionEntry.includes('real_ip_recursive on;'))
  assert.ok(productionEntry.includes('set_real_ip_from %s;'))
  assert.ok(productionEntry.includes('include /etc/nginx/snippets/ecfc-cloudflare-real-ip.conf;'))
  assert.ok(productionEntry.includes('Application port must be bound to localhost behind Nginx.'))
  assert.ok(!productionEntry.includes('proxy_set_header CF-Connecting-IP "";'))
  assert.ok(!productionEntry.includes('proxy_set_header CF-Connecting-IP \\$remote_addr;'))
  assert.ok(productionEntry.includes('proxy_set_header X-Forwarded-For \\$remote_addr;'))
  assert.ok(!productionEntry.includes('proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;'))
  assert.match(ipResolver, /TRUSTED_CLIENT_IP_SOURCE/)
  assert.match(ipResolver, /TRUSTED_CLOUDFLARE_GEO_CONTEXT/)
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'CN', region_code: '44', org: 'test' })?.label, '广东')
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'CN', region: '广西壮族自治区' })?.label, '广西')
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'CN', region: 'Guangdong Sheng' })?.label, '广东')
  assert.equal(normalizeIpLocationProviderResponse({ country_code: 'CN', region: 'Guangxi Zhuangzu Zizhiqu' })?.label, '广西')
  assert.equal(normalizeIpRegionFromGeo({ country: 'CN' }), null)
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
  const providerUrls: string[] = []

  process.env.IP_LOCATION_API_URL = 'https://unit.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  process.env.IP_DIAGNOSTICS_LOG = 'false'
  clearIpLocationCacheForTests()
  globalThis.fetch = async (input) => {
    providerCalls += 1
    providerUrls.push(String(input))
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
    assert.ok(providerUrls.some((url) => url.includes(encodeURIComponent('203.0.113.10'))))
    assert.ok(providerUrls.some((url) => url.includes(encodeURIComponent('2409:8a00:1234::10'))))
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
    assert.equal(getClientIp(new Request('https://ecfc.fans', {
      headers: { 'cf-connecting-ip': '::ffff:203.0.113.20', 'x-ecfc-client-ip': '203.0.113.20' },
    })), '203.0.113.20')
    assert.equal(getClientIp(new Request('https://ecfc.fans', {
      headers: { 'cf-connecting-ip': '203.0.113.20' },
    })), 'unknown')
    assert.equal(getClientIp(new Request('https://ecfc.fans', {
      headers: { 'cf-connecting-ip': '203.0.113.20', 'x-ecfc-client-ip': '203.0.113.19' },
    })), '203.0.113.19')

    process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx-forwarded'
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-forwarded-for': '203.0.113.21', 'x-ecfc-client-ip': '203.0.113.21' } })), '203.0.113.21')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-forwarded-for': '10.0.0.1, ::ffff:203.0.113.22, 203.0.113.23', 'x-ecfc-client-ip': '203.0.113.22' } })), '203.0.113.22')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-real-ip': '203.0.113.24', 'x-ecfc-client-ip': '203.0.113.24' } })), '203.0.113.24')

    process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-ecfc-client-ip': '::ffff:203.0.113.25' } })), '203.0.113.25')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-ecfc-client-ip': '10.0.0.1', 'x-real-ip': '203.0.113.26' } })), 'unknown')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'cf-connecting-ip': '203.0.113.26' } })), 'unknown')
    assert.equal(getClientIp(new Request('https://ecfc.fans', { headers: { 'x-ecfc-client-ip': '127.0.0.1' } })), 'unknown')
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
  const diagnostics = getClientIpDiagnostics(request, '203.0.113.24')
  assert.equal(diagnostics.hasCfConnectingIp, true)
  assert.equal(diagnostics.hasXRealIp, true)
  assert.equal(diagnostics.hasTrustedClientIp, false)
  assert.equal(diagnostics.forwardedForCount, 1)
  assert.equal(diagnostics.hasRemoteAddress, true)
  assert.equal(diagnostics.resolvedIp, '203.***.***.24')
  assert.doesNotMatch(JSON.stringify(diagnostics), /203\.0\.113\./)
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

test('normalizes mapped IPv4 and native IPv6 while rejecting non-public addresses', () => {
  assert.equal(normalizeIp('::ffff:123.123.123.123'), '123.123.123.123')
  assert.equal(normalizeIp('240e:8a00:1234::10'), '240e:8a00:1234::10')
  assert.equal(isPublicIp('240e:8a00:1234::10'), true)
  assert.equal(isPublicIp('127.0.0.1'), false)
  assert.equal(isPublicIp('10.0.0.1'), false)
  assert.equal(isPublicIp('192.168.1.10'), false)
  assert.equal(isPublicIp('fc00::1'), false)
  assert.equal(isPublicIp('fe80::1'), false)
})

test('reports the selected trusted header and refuses forged forwarded headers', () => {
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  try {
    process.env.TRUSTED_CLIENT_IP_SOURCE = 'cloudflare'
    assert.deepEqual(
      getClientIpResolution(new Request('https://ecfc.fans', {
        headers: { 'cf-connecting-ip': '240e:8a00:1234::10', 'x-ecfc-client-ip': '240e:8a00:1234::10' },
      })),
      { ip: '240e:8a00:1234::10', source: 'cf-connecting-ip', status: 'success' },
    )

    process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx-forwarded'
    assert.deepEqual(
      getClientIpResolution(new Request('https://ecfc.fans', {
        headers: { 'x-forwarded-for': '10.0.0.1, ::ffff:123.123.123.123, 127.0.0.1', 'x-ecfc-client-ip': '123.123.123.123' },
      })),
      { ip: '123.123.123.123', source: 'x-forwarded-for', status: 'success' },
    )

    process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
    assert.equal(
      getClientIpResolution(new Request('https://ecfc.fans', {
        headers: { 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '1.1.1.1' },
      })).status,
      'none',
    )
    assert.equal(
      getClientIpResolution(new Request('https://ecfc.fans', {
        headers: { 'x-ecfc-client-ip': '127.0.0.1' },
      })).status,
      'private-ip',
    )
  } finally {
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
  }
})

test('True-Client-IP 仅在 Cloudflare 模式且与可信重写值一致时作为候选，且无法绕过可信来源', () => {
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  try {
    // Cloudflare 模式：cf-connecting-ip 缺失时，true-client-ip 与 x-ecfc-client-ip
    // 一致即可作为候选被解析（source 标记为 true-client-ip）。
    process.env.TRUSTED_CLIENT_IP_SOURCE = 'cloudflare'
    assert.equal(getClientIp(new Request('https://ecfc.fans', {
      headers: { 'true-client-ip': '203.0.113.30', 'x-ecfc-client-ip': '203.0.113.30' },
    })), '203.0.113.30')
    assert.equal(
      getClientIpResolution(new Request('https://ecfc.fans', {
        headers: { 'true-client-ip': '203.0.113.30', 'x-ecfc-client-ip': '203.0.113.30' },
      })).source,
      'true-client-ip',
    )

    // Cloudflare 模式：true-client-ip 与可信重写值不一致时被丢弃，不能污染结果。
    assert.equal(getClientIp(new Request('https://ecfc.fans', {
      headers: {
        'cf-connecting-ip': '203.0.113.30',
        'true-client-ip': '9.9.9.9',
        'x-ecfc-client-ip': '203.0.113.30',
      },
    })), '203.0.113.30')

    // Nginx 模式（生产默认）：伪造 true-client-ip / cf-connecting-ip 都无法覆盖
    // 可信的 x-ecfc-client-ip（对应任务 Test 8：非可信链路下伪造 header 无效）。
    process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
    assert.equal(getClientIp(new Request('https://ecfc.fans', {
      headers: {
        'x-ecfc-client-ip': '203.0.113.30',
        'true-client-ip': '9.9.9.9',
        'cf-connecting-ip': '9.9.9.9',
        'x-forwarded-for': '9.9.9.9',
      },
    })), '203.0.113.30')
    assert.equal(
      getClientIpResolution(new Request('https://ecfc.fans', {
        headers: {
          'x-ecfc-client-ip': '203.0.113.30',
          'true-client-ip': '9.9.9.9',
        },
      })).source,
      'x-ecfc-client-ip',
    )
  } finally {
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
  }
})

test('realIpRewriteMismatch 诊断标记 Nginx realip 未生效的链路', () => {
  // realip 生效：X-ECFC-Client-IP（$remote_addr）与 CF-Connecting-IP 一致 → 不报警。
  assert.equal(getClientIpDiagnostics(new Request('https://ecfc.fans', {
    headers: { 'x-ecfc-client-ip': '203.0.113.40', 'cf-connecting-ip': '203.0.113.40' },
  }), '203.0.113.40').realIpRewriteMismatch, false)

  // realip 未生效：可信重写值与 Cloudflare 头不一致（典型为中间代理占据 $remote_addr）→ 报警。
  assert.equal(getClientIpDiagnostics(new Request('https://ecfc.fans', {
    headers: { 'x-ecfc-client-ip': '198.51.100.7', 'cf-connecting-ip': '203.0.113.40' },
  }), '198.51.100.7').realIpRewriteMismatch, true)

  // 未经过 Cloudflare（无 CF-Connecting-IP）时不误报。
  assert.equal(getClientIpDiagnostics(new Request('https://ecfc.fans', {
    headers: { 'x-ecfc-client-ip': '203.0.113.40' },
  }), '203.0.113.40').realIpRewriteMismatch, false)

  // 缺少可信重写值时不误报。
  assert.equal(getClientIpDiagnostics(new Request('https://ecfc.fans', {
    headers: { 'cf-connecting-ip': '203.0.113.40' },
  }), 'unknown').realIpRewriteMismatch, false)

  // 报警标记本身不含完整 IP（隐私）。
  const diagnostics = getClientIpDiagnostics(new Request('https://ecfc.fans', {
    headers: { 'x-ecfc-client-ip': '198.51.100.7', 'cf-connecting-ip': '203.0.113.40' },
  }), '198.51.100.7')
  assert.equal(diagnostics.realIpRewriteMismatch, true)
  assert.doesNotMatch(JSON.stringify(diagnostics.realIpRewriteMismatch), /\d+\.\d+\.\d+\.\d+/)
})

test('TRUSTED_CLIENT_IP_SOURCE=cloudflare 不再隐式启用 Cloudflare Geo：cf 返回广东时仍以 provider 为准', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  const previousCfGeo = process.env.TRUSTED_CLOUDFLARE_GEO_CONTEXT
  const previousDiagnostics = process.env.IP_DIAGNOSTICS_LOG

  process.env.IP_LOCATION_API_URL = 'https://unit.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'cloudflare'
  delete process.env.TRUSTED_CLOUDFLARE_GEO_CONTEXT
  process.env.IP_DIAGNOSTICS_LOG = 'false'
  clearIpLocationCacheForTests()

  // Simulate the production bug condition: a real Next.js request context in
  // which getCloudflareContext returns a cf object that is NOT bound to the
  // current client IP and resolves to Guangdong.
  setCloudflareGeoContextReaderForTests(async () => ({
    country: 'CN',
    region: 'Guangdong',
    regionCode: 'GD',
  }))

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ country_code: 'CN', region_code: 'YN' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })

  try {
    const request = new Request('https://ecfc.fans/api/posts', {
      headers: { 'x-ecfc-client-ip': '106.60.110.101', 'cf-connecting-ip': '106.60.110.101' },
    })

    // Default (switch off): IP source does NOT control Geo source → provider wins → 云南, never 广东.
    assert.equal((await resolveIpLocation(request))?.label, '云南')

    // Explicit switch on: cf context wins → 广东 (proves the switch is what gates it).
    process.env.TRUSTED_CLOUDFLARE_GEO_CONTEXT = 'true'
    assert.equal((await resolveIpLocation(request))?.label, '广东')
  } finally {
    globalThis.fetch = originalFetch
    setCloudflareGeoContextReaderForTests(null)
    clearIpLocationCacheForTests()
    if (previousApiUrl === undefined) delete process.env.IP_LOCATION_API_URL
    else process.env.IP_LOCATION_API_URL = previousApiUrl
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
    if (previousCfGeo === undefined) delete process.env.TRUSTED_CLOUDFLARE_GEO_CONTEXT
    else process.env.TRUSTED_CLOUDFLARE_GEO_CONTEXT = previousCfGeo
    if (previousDiagnostics === undefined) delete process.env.IP_DIAGNOSTICS_LOG
    else process.env.IP_DIAGNOSTICS_LOG = previousDiagnostics
  }
})

test('不同真实公网 IP 的 Geo 结果按 IP 独立缓存且互不污染', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  const previousDiagnostics = process.env.IP_DIAGNOSTICS_LOG

  process.env.IP_LOCATION_API_URL = 'https://unit.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  process.env.IP_DIAGNOSTICS_LOG = 'false'
  clearIpLocationCacheForTests()

  const ipToRegion: Record<string, string> = {
    '106.60.110.101': 'YN',
    '39.144.138.232': 'SC',
    '39.65.220.46': 'SD',
  }
  let fetchCalls = 0
  globalThis.fetch = async (input) => {
    fetchCalls += 1
    const url = String(input)
    const ip = Object.keys(ipToRegion).find((key) => url.includes(encodeURIComponent(key)))
    return new Response(
      JSON.stringify({ country_code: 'CN', region_code: ip ? ipToRegion[ip] : '44' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  try {
    const yunnan = new Request('https://ecfc.fans/api/posts', { headers: { 'x-ecfc-client-ip': '106.60.110.101' } })
    const sichuan = new Request('https://ecfc.fans/api/posts', { headers: { 'x-ecfc-client-ip': '39.144.138.232' } })
    const shandong = new Request('https://ecfc.fans/api/posts', { headers: { 'x-ecfc-client-ip': '39.65.220.46' } })

    assert.equal((await resolveIpLocation(yunnan))?.label, '云南')
    assert.equal((await resolveIpLocation(sichuan))?.label, '四川')
    assert.equal((await resolveIpLocation(shandong))?.label, '山东')

    const callsAfterFirstRound = fetchCalls
    assert.equal(callsAfterFirstRound, 3)

    // Second round must hit the per-IP cache, not re-query the provider, and
    // each IP must still resolve to its own province (no cross-IP pollution).
    assert.equal((await resolveIpLocation(yunnan))?.label, '云南')
    assert.equal((await resolveIpLocation(sichuan))?.label, '四川')
    assert.equal((await resolveIpLocation(shandong))?.label, '山东')
    assert.equal(fetchCalls, callsAfterFirstRound)
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

test('主 Geo provider 返回 429 时回退到 fallback provider 并返回其结果', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousFallbackUrl = process.env.IP_LOCATION_FALLBACK_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  const previousDiagnostics = process.env.IP_DIAGNOSTICS_LOG

  process.env.IP_LOCATION_API_URL = 'https://primary.test/{ip}/json/'
  process.env.IP_LOCATION_FALLBACK_API_URL = 'https://fallback.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  process.env.IP_DIAGNOSTICS_LOG = 'false'
  clearIpLocationCacheForTests()

  const requestedUrls: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url.startsWith('https://primary.test')) return new Response('', { status: 429 })
    return new Response(JSON.stringify({ country_code: 'CN', region_code: 'YN' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    const location = await resolveIpLocation(new Request('https://ecfc.fans/api/posts', {
      headers: { 'x-ecfc-client-ip': '106.60.110.101' },
    }))
    assert.equal(location?.label, '云南')
    assert.ok(requestedUrls.some((url) => url.startsWith('https://primary.test')))
    assert.ok(requestedUrls.some((url) => url.startsWith('https://fallback.test')))
  } finally {
    globalThis.fetch = originalFetch
    clearIpLocationCacheForTests()
    if (previousApiUrl === undefined) delete process.env.IP_LOCATION_API_URL
    else process.env.IP_LOCATION_API_URL = previousApiUrl
    if (previousFallbackUrl === undefined) delete process.env.IP_LOCATION_FALLBACK_API_URL
    else process.env.IP_LOCATION_FALLBACK_API_URL = previousFallbackUrl
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
    if (previousDiagnostics === undefined) delete process.env.IP_DIAGNOSTICS_LOG
    else process.env.IP_DIAGNOSTICS_LOG = previousDiagnostics
  }
})

test('主 Geo provider 429 后进入 cooldown，不会对每个新 IP 重复请求', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousFallbackUrl = process.env.IP_LOCATION_FALLBACK_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  const previousDiagnostics = process.env.IP_DIAGNOSTICS_LOG

  process.env.IP_LOCATION_API_URL = 'https://primary.test/{ip}/json/'
  process.env.IP_LOCATION_FALLBACK_API_URL = 'https://fallback.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  process.env.IP_DIAGNOSTICS_LOG = 'false'
  clearIpLocationCacheForTests()

  const requestedUrls: string[] = []
  globalThis.fetch = async (input) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url.startsWith('https://primary.test')) return new Response('', { status: 429 })
    return new Response(JSON.stringify({ country_code: 'CN', region_code: 'GD' }), { status: 200 })
  }

  try {
    await resolveIpLocation(new Request('https://ecfc.fans/api/posts', { headers: { 'x-ecfc-client-ip': '106.60.110.102' } }))
    await resolveIpLocation(new Request('https://ecfc.fans/api/posts', { headers: { 'x-ecfc-client-ip': '106.60.110.103' } }))
    assert.equal(requestedUrls.filter((url) => url.startsWith('https://primary.test')).length, 1)
    assert.equal(requestedUrls.filter((url) => url.startsWith('https://fallback.test')).length, 2)
  } finally {
    globalThis.fetch = originalFetch
    clearIpLocationCacheForTests()
    if (previousApiUrl === undefined) delete process.env.IP_LOCATION_API_URL
    else process.env.IP_LOCATION_API_URL = previousApiUrl
    if (previousFallbackUrl === undefined) delete process.env.IP_LOCATION_FALLBACK_API_URL
    else process.env.IP_LOCATION_FALLBACK_API_URL = previousFallbackUrl
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
    if (previousDiagnostics === undefined) delete process.env.IP_DIAGNOSTICS_LOG
    else process.env.IP_DIAGNOSTICS_LOG = previousDiagnostics
  }
})

test('主 provider 与 fallback 全部失败时返回 null，绝不退回广东', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousFallbackUrl = process.env.IP_LOCATION_FALLBACK_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  const previousDiagnostics = process.env.IP_DIAGNOSTICS_LOG

  process.env.IP_LOCATION_API_URL = 'https://primary.test/{ip}/json/'
  process.env.IP_LOCATION_FALLBACK_API_URL = 'https://fallback.test/{ip}/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  process.env.IP_DIAGNOSTICS_LOG = 'false'
  clearIpLocationCacheForTests()

  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.startsWith('https://primary.test')) return new Response('', { status: 429 })
    return new Response('', { status: 500 })
  }

  try {
    const location = await resolveIpLocation(new Request('https://ecfc.fans/api/posts', {
      headers: { 'x-ecfc-client-ip': '106.60.110.101' },
    }))
    assert.equal(location, null)
  } finally {
    globalThis.fetch = originalFetch
    clearIpLocationCacheForTests()
    if (previousApiUrl === undefined) delete process.env.IP_LOCATION_API_URL
    else process.env.IP_LOCATION_API_URL = previousApiUrl
    if (previousFallbackUrl === undefined) delete process.env.IP_LOCATION_FALLBACK_API_URL
    else process.env.IP_LOCATION_FALLBACK_API_URL = previousFallbackUrl
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
    if (previousDiagnostics === undefined) delete process.env.IP_DIAGNOSTICS_LOG
    else process.env.IP_DIAGNOSTICS_LOG = previousDiagnostics
  }
})

test('requires an explicit target IP in the configured GeoIP URL', async () => {
  const originalFetch = globalThis.fetch
  const previousApiUrl = process.env.IP_LOCATION_API_URL
  const previousSource = process.env.TRUSTED_CLIENT_IP_SOURCE
  let providerCalled = false
  process.env.IP_LOCATION_API_URL = 'https://unit.test/json/'
  process.env.TRUSTED_CLIENT_IP_SOURCE = 'nginx'
  clearIpLocationCacheForTests()
  globalThis.fetch = async () => {
    providerCalled = true
    return new Response(JSON.stringify({ country_code: 'CN', region_code: '44' }), { status: 200 })
  }
  try {
    const location = await resolveIpLocation(new Request('https://ecfc.fans/api/posts', {
      headers: { 'x-ecfc-client-ip': '123.123.123.123' },
    }))
    assert.equal(location, null)
    assert.equal(providerCalled, false)
  } finally {
    globalThis.fetch = originalFetch
    clearIpLocationCacheForTests()
    if (previousApiUrl === undefined) delete process.env.IP_LOCATION_API_URL
    else process.env.IP_LOCATION_API_URL = previousApiUrl
    if (previousSource === undefined) delete process.env.TRUSTED_CLIENT_IP_SOURCE
    else process.env.TRUSTED_CLIENT_IP_SOURCE = previousSource
  }
})

test('unknown IP regions are visible as unknown and do not reuse a stale user region', () => {
  assert.doesNotMatch(ipRegionLabel, /return null/)
  assert.match(ipRegionLabel, /IP属地：/)
  assert.match(ipResolver, /where: \{ id: userId \}/)
  assert.match(ipResolver, /data: \{ ipRegion: region, ipRegionUpdatedAt: new Date\(\) \}/)
  assert.doesNotMatch(ipResolver, /if \(!region\) return null/)
})
