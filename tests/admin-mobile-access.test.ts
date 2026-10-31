import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('Admin Mobile capability discovery is guarded by the shared server role and permission set', () => {
  const route = read('app/api/admin/mobile-capabilities/route.ts')
  assert.match(route, /const guard = await requireAdmin\(\)/)
  assert.match(route, /getAdminPermissionSet\(guard\.user\)/)
  assert.match(route, /module\.permissions\.filter/)
  assert.match(route, /available: module\.apiAvailable/)
  assert.match(route, /scopes\.length \? \[\{ id: module\.id, label: module\.label, available: module\.apiAvailable, scopes \}\]/)
  assert.match(route, /'easmusic-dog'[\s\S]*apiAvailable: false/)
  assert.match(route, /\{ id: 'activities', label: '活动核销', permissions: \['activity_manage'\], apiAvailable: true \}/)
})

test('Admin search never lists all administrators and caps each query page', () => {
  const route = read('app/api/admin/admins/route.ts')
  assert.match(route, /requireAdmin\('admin_manage'\)/)
  assert.match(route, /AdminPermission: \{ where: \{ enabled: true \}, select: \{ permissionKey: true \} \}/)
  assert.match(route, /permissions: AdminPermission\.map\(\(\{ permissionKey \}\) => permissionKey\)/)
  assert.match(route, /if \(!query\) return NextResponse\.json\(\{ admins: \[\]/)
  assert.match(route, /MAX_SEARCH_PAGE_SIZE = 30/)
  assert.match(route, /skip: \(page - 1\) \* pageSize/)
  assert.match(route, /take: pageSize \+ 1/)
  assert.doesNotMatch(route, /email: true|phone: true|password/i)
})

test('Mobile Bearer reaches admin handlers but every request still passes the server permission guard', () => {
  const middleware = read('middleware.ts')
  const security = read('lib/security.ts')
  assert.ok(middleware.includes('^\\/api\\/admin(?:\\/|$)'))
  assert.match(security, /requireRequestAdmin\(bearerRequest, permissionKey\)/)
  assert.match(security, /hasAdminPermission\(result\.user, permissionKey\)/)
  assert.match(security, /async function authorizationRequest\(request\?: Request\)/)
})

test('Badge and entertainment admin reads support bounded pages for native clients', () => {
  const badgesRoute = read('app/api/admin/badges/route.ts')
  const badgesService = read('lib/badge-service.ts')
  const lyricsRoute = read('app/api/admin/entertainment/lyrics/route.ts')
  assert.match(badgesRoute, /\.\.\.\(paged \? \{ page, pageSize \} : \{\}\)/)
  assert.match(badgesService, /take: boundedPageSize \+ 1/)
  assert.match(lyricsRoute, /pageSize = .*Math\.min\(50/)
  assert.match(lyricsRoute, /take: pageSize \+ 1/)
  assert.match(lyricsRoute, /if \(!paged\)[\s\S]*take: 500[\s\S]*data: \{ lyrics \}/)
})

test('Mobile user directory requires a search and returns no contact or security details', () => {
  const route = read('app/api/admin/users/route.ts')
  assert.match(route, /searchParams\.get\('client'\) === 'mobile'/)
  assert.match(route, /if \(mobileDirectory && !keyword\)[\s\S]*users: \[\]/)
  assert.match(route, /if \(mobileDirectory\)[\s\S]*id: user\.id,[\s\S]*username: user\.username,[\s\S]*role: user\.role/)
  assert.match(route, /!mobileDirectory \? \[\{ email: \{ contains: keyword \} \}, \{ phone: \{ contains: keyword \} \}\]/)
  assert.doesNotMatch(route, /return \{[\s\S]{0,240}email: user\.email/)
})
