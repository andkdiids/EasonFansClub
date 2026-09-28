import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { publicProfileIpRegion } from '../lib/ip-region'

const read = (path: string) => readFileSync(path, 'utf8')

test('Profile IP display accepts only canonical province or country labels', () => {
  assert.equal(publicProfileIpRegion('广东'), '广东')
  assert.equal(publicProfileIpRegion('广西'), '广西')
  assert.equal(publicProfileIpRegion('日本'), '日本')
  assert.equal(publicProfileIpRegion('美国'), '美国')
  assert.equal(publicProfileIpRegion(null), null)
  assert.equal(publicProfileIpRegion(''), null)
  assert.equal(publicProfileIpRegion('深圳'), null)
  assert.equal(publicProfileIpRegion('192.0.2.1'), null)
  assert.equal(publicProfileIpRegion('2001:db8::1'), null)
  assert.equal(publicProfileIpRegion('22.5,113.9'), null)
  assert.equal(publicProfileIpRegion('https://example.com'), null)
})

test('owner Profile DTO exposes only the sanitized stored User.ipRegion', () => {
  const route = read('app/api/users/me/route.ts')
  const get = route.slice(route.indexOf('export async function GET(request: Request)'), route.indexOf('export async function PATCH('))
  assert.match(get, /requireRequestUser\(request\)/)
  assert.match(get, /ipRegion: true/)
  assert.match(get, /ipRegion: publicProfileIpRegion\(profile\.ipRegion\)/)
  assert.doesNotMatch(get, /ipAddress:|rawIp:|latitude:|longitude:/)
})

test('public profile lookup uses the same safe IP label without raw network data', () => {
  const route = read('app/api/friends/list/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /const publicFriendSelect = \{[\s\S]*?ipRegion: true/)
  assert.match(route, /ipRegion: publicProfileIpRegion\(friend\.ipRegion\)/)
  assert.doesNotMatch(route, /ipAddress:|rawIp:|latitude:|longitude:/)
})

test('the existing nullable User.ipRegion field is reused; no new migration is needed', () => {
  const schema = read('prisma/schema.prisma')
  const resolver = read('lib/ip-region.ts')
  assert.match(schema, /model User \{[\s\S]*?ipRegion\s+String\?/)
  assert.match(resolver, /data: \{ ipRegion: region, ipRegionUpdatedAt: new Date\(\) \}/)
  assert.match(resolver, /export function publicProfileIpRegion/)
})
