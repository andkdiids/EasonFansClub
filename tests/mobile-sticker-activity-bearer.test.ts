import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

test('mobile sticker catalogue, detail, library, add, and remove bind identity through request authentication', () => {
  const routes = [
    source('app/api/stickers/store/route.ts'),
    source('app/api/stickers/store/[packId]/route.ts'),
    source('app/api/stickers/center/route.ts'),
    source('app/api/stickers/store/[packId]/add/route.ts'),
  ]
  for (const route of routes) {
    assert.match(route, /requireRequestUser\(request\)/)
    assert.doesNotMatch(route, /getCurrentUser\(\)/)
    assert.doesNotMatch(route, /unauthenticatedResponse\(\)/)
  }
  for (const route of routes.slice(0, 3)) {
    assert.match(route, /const privateHeaders = \{ 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' \}/)
    assert.match(route, /headers: privateHeaders/)
  }
  const add = routes[3]!
  assert.match(add, /addPackToLibrary\(guard\.user\.id, packId\)/)
  assert.match(add, /removePackFromLibrary\(guard\.user\.id, packId\)/)
})

test('middleware admits only the required sticker and activity routes for Bearer requests', () => {
  const middleware = source('middleware.ts')
  assert.ok(middleware.includes("pathname === '/api/stickers/store'"))
  assert.ok(middleware.includes("/^\\/api\\/stickers\\/store\\/[^/]+$/.test(pathname)"))
  assert.ok(middleware.includes("pathname === '/api/stickers/center'"))
  assert.ok(middleware.includes("pathname === '/api/activities/me/registrations'"))
  assert.ok(middleware.includes("/^\\/api\\/activities\\/[^/]+\\/register$/.test(pathname)"))
  assert.ok(middleware.includes("/^\\/api\\/activities\\/[^/]+\\/register\\/cancel$/.test(pathname)"))
  assert.ok(!middleware.includes("pathname.startsWith('/api/stickers'"))
})

test('activity detail and registration mutations keep request identity and both cache vary keys', () => {
  const detail = source('app/api/activities/[activityId]/route.ts')
  const register = source('app/api/activities/[activityId]/register/route.ts')
  const cancel = source('app/api/activities/[activityId]/register/cancel/route.ts')
  for (const route of [register, cancel]) {
    assert.match(route, /requireRequestUser\(request\)/)
    assert.match(route, /Vary: 'Cookie, Authorization'/)
    assert.doesNotMatch(route, /requireUser\(\)/)
  }
  assert.match(detail, /resolveRequestAuth\(request\)/)
  assert.match(detail, /Vary: 'Cookie, Authorization'/)
})

test('my activity registrations are private, paginated, and scoped to the authenticated user', () => {
  const route = source('app/api/activities/me/registrations/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /userId: guard\.user\.id/)
  assert.match(route, /pageSize = Math\.min\(50/)
  assert.match(route, /page = Math\.min\(1_000_000/)
  assert.match(route, /serializeActivityRow\(row\.Activity\)/)
  assert.match(route, /serializeActivityRegistration\(row\)/)
  assert.match(route, /Vary: 'Cookie, Authorization'/)
  assert.doesNotMatch(route, /getCurrentUser|userId:\s*params/)
})
