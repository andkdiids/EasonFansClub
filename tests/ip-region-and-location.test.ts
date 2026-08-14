import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeIpRegionFromGeo } from '../lib/ip-region'
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
const ipResolver = read('lib/ip-region.ts')
const profileApi = read('app/api/users/me/route.ts')
const profileSurface = read('components/ProfilePageSurface.tsx')
const profileForm = read('app/profile/ProfileSettingsForm.tsx')
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
  assert.doesNotMatch(ipResolver, /getClientIp\(/)
  assert.doesNotMatch(ipResolver, /rawIp|clientIp|forwardedFor/)
  assert.match(ipResolver, /getCloudflareContext\(\{ async: true \}\)/)
  assert.match(ipResolver, /TRUSTED_EDGE_GEO_HEADERS/)
})

test('数据库只保存 nullable 的处理后属地，旧记录无需回填', () => {
  for (const model of ['CultureComment', 'DailyMessage', 'DailyMessageComment', 'ProfileWallMessage', 'Reply']) {
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
})
