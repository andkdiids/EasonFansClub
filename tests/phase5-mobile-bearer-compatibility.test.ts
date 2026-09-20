import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(process.cwd())
const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')
const withoutComments = (value: string) => value.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

const checkinRoutes = [
  'app/api/checkin/route.ts',
  'app/api/checkin/history/route.ts',
  'app/api/checkin/history/[dateKey]/route.ts',
  'app/api/entertainment/daily-draw/route.ts',
  'app/api/entertainment/daily-draw/history/route.ts',
  'app/api/points/today/route.ts',
  'app/api/points/history/route.ts',
]

const entertainmentRoutes = [
  'app/api/entertainment/guess-song/sessions/route.ts',
  'app/api/entertainment/guess-song/sessions/[sessionId]/route.ts',
  'app/api/entertainment/guess-song/sessions/[sessionId]/play/route.ts',
  'app/api/entertainment/guess-song/sessions/[sessionId]/audio/route.ts',
  'app/api/entertainment/guess-song/sessions/[sessionId]/answer/route.ts',
  'app/api/entertainment/guess-song/sessions/[sessionId]/pause/route.ts',
  'app/api/entertainment/guess-song/sessions/[sessionId]/resume/route.ts',
  'app/api/entertainment/guess-song/sessions/[sessionId]/abandon/route.ts',
  'app/api/entertainment/guess-song/search/route.ts',
  'app/api/entertainment/guess-song/leaderboard/route.ts',
  'app/api/entertainment/leaderboard/route.ts',
  'app/api/entertainment/forget-lyrics/route.ts',
]

test('Phase 5 checkin, prescription and points routes use the shared request auth resolver', () => {
  for (const file of checkinRoutes) {
    const route = withoutComments(source(file))
    assert.match(route, /requireRequestUser\(request\)/, file)
    assert.doesNotMatch(route, /requireUser\(|getCurrentUser\(/, file)
  }
})

test('Entertainment Phase 1 routes use request auth without widening to other games', () => {
  for (const file of entertainmentRoutes) {
    const route = withoutComments(source(file))
    assert.match(route, /requireRequestUser\(request\)/, file)
    assert.doesNotMatch(route, /requireUser\(|getCurrentUser\(/, file)
  }
  const middleware = source('middleware.ts')
  assert.doesNotMatch(middleware, /pathname\.startsWith\(['"]\/api\/entertainment\//)
  for (const deferred of ['want-listen', 'duel/rooms', 'duel/matches', 'duel/invites', 'duel/stats']) {
    assert.doesNotMatch(middleware, new RegExp(`isMobileBearerBusinessRequest[\\s\\S]{0,6000}${deferred.replace('/', '\\/')}`))
  }
})

test('Bearer precedence remains strict and malformed or invalid Bearer cannot fall back to Cookie', () => {
  const security = source('lib/security.ts')
  assert.match(security, /if \(request\.headers\.has\('authorization'\)\)/)
  assert.match(security, /if \(!token\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(security, /resolveMobileAccess\(request\)/)
  assert.match(security, /getCurrentUserById\(mobileAccess\.claims\.userId\)/)
  const bearerBranch = security.slice(
    security.indexOf("if (request.headers.has('authorization'))"),
    security.indexOf('\n  try {', security.indexOf("if (request.headers.has('authorization'))") + 1),
  )
  assert.doesNotMatch(bearerBranch, /getCurrentUser\(\)/)
})

test('approved methods and paths are explicitly allowlisted, including audio HEAD', () => {
  const middleware = source('middleware.ts')
  for (const path of [
    '/api/checkin',
    '/api/checkin/history',
    '/api/entertainment/daily-draw',
    '/api/entertainment/daily-draw/history',
    '/api/points/today',
    '/api/points/history',
    '/api/entertainment/guess-song/sessions',
    '/api/entertainment/guess-song/search',
    '/api/entertainment/guess-song/leaderboard',
    '/api/entertainment/leaderboard',
    '/api/entertainment/forget-lyrics',
  ]) assert.match(middleware, new RegExp(path.replaceAll('/', '\\/')), path)
  assert.match(middleware, /request\.method === 'HEAD'/)
  assert.match(middleware, /sessions\\\/\[\^\/\]\+\\\/audio/)
  assert.doesNotMatch(middleware, /pathname === '\/api\/checkin\/message'/)
  assert.doesNotMatch(middleware, /pathname === '\/api\/checkin\/messages'/)
})

test('Cookie mutation origin checks remain in place and native requests are not treated as browser CSRF', () => {
  const security = source('lib/security.ts')
  assert.match(security, /if \(!source\) return true/)
  assert.match(security, /fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none'/)
  for (const file of [
    'app/api/entertainment/daily-draw/route.ts',
    'app/api/entertainment/guess-song/sessions/route.ts',
    'app/api/entertainment/guess-song/sessions/[sessionId]/play/route.ts',
    'app/api/entertainment/guess-song/sessions/[sessionId]/answer/route.ts',
    'app/api/entertainment/guess-song/sessions/[sessionId]/pause/route.ts',
    'app/api/entertainment/guess-song/sessions/[sessionId]/resume/route.ts',
    'app/api/entertainment/guess-song/sessions/[sessionId]/abandon/route.ts',
  ]) assert.match(source(file), /rejectInvalidRequestOrigin\(request\)/, file)
})

test('Guess Song audio supports Bearer direct streaming and Bearer media-gateway authorization', () => {
  const play = source('app/api/entertainment/guess-song/sessions/[sessionId]/play/route.ts')
  const audio = source('app/api/entertainment/guess-song/sessions/[sessionId]/audio/route.ts')
  const authorize = source('app/api/internal/media/guess-song/authorize/route.ts')
  const session = source('lib/guess-song-session.ts')
  const protectedAudio = source('lib/protected-audio.ts')
  const nginx = source('deploy/nginx/ecfc-media-private-audio.conf.example')
  assert.match(play, /requireRequestUser\(request\)/)
  assert.match(audio, /requireRequestUser\(request\)/)
  assert.match(authorize, /requireRequestUser\(request\)/)
  assert.match(session, /buildGuessSongMediaUrl/)
  assert.match(session, /audioUrl/)
  assert.match(protectedAudio, /request\.headers\.get\('range'\)/)
  assert.match(protectedAudio, /status = range \? 206 : 200/)
  assert.match(protectedAudio, /Content-Range/)
  assert.match(protectedAudio, /request\.method === 'HEAD'/)
  assert.match(nginx, /proxy_set_header Authorization \$http_authorization/)
  assert.match(nginx, /proxy_set_header Range \$http_range/)
})

test('Badge Phase 1 routes use shared auth and mutation ownership comes only from the guard', () => {
  for (const file of [
    'app/api/users/me/badges/route.ts',
    'app/api/users/me/badges/[badgeId]/route.ts',
    'app/api/users/me/badge/equip/route.ts',
  ]) {
    const route = withoutComments(source(file))
    assert.match(route, /requireRequestUser\(request\)/, file)
    assert.doesNotMatch(route, /requireUser\(|getCurrentUser\(/, file)
  }
  assert.match(source('app/api/badge-series/[seriesId]/route.ts'), /resolveRequestAuth\(request\)/)
  const equip = source('app/api/users/me/badge/equip/route.ts')
  assert.match(equip, /equipBadge\(guard\.user\.id, badgeId\)/)
  assert.match(equip, /unequipBadge\(guard\.user\.id, badgeId\)/)
  assert.match(equip, /reorderEquippedBadges\(guard\.user\.id, body\.badgeIds/)
  assert.doesNotMatch(equip, /body\?\.(?:userId|uid)/)
})

test('Badge ownership, wearable state, ordering and visibility rules remain server-owned', () => {
  const service = source('lib/badge-service.ts')
  assert.match(service, /where: \{ userId, badgeId, \.\.\.activeUserBadgeWhere\(\) \}/)
  assert.match(service, /BadgeServiceError\('NOT_OWNED'/)
  assert.match(service, /BadgeServiceError\('BADGE_DISABLED'/)
  assert.match(service, /BadgeServiceError\('BADGE_NOT_WEARABLE'/)
  assert.match(service, /排序必须包含当前全部有效佩戴勋章/)
  assert.match(service, /if \(badge\.visibility === 'SECRET'\) return \[\]/)
  assert.match(service, /visibility !== 'SECRET'/)
  assert.match(service, /name: '\?\?\?'/)
})

test('Badge allowlist is exact and deferred Badge APIs remain excluded', () => {
  const middleware = source('middleware.ts')
  const allowlist = middleware.slice(
    middleware.indexOf('function isMobileBearerBusinessRequest'),
    middleware.indexOf('\nfunction isApiPath'),
  )
  for (const approved of ['/api/users/me/badges', '/api/users/me/badge/equip', 'badge-series']) {
    assert.match(allowlist, new RegExp(approved.replaceAll('/', '\\/')), approved)
  }
  for (const deferred of ['badge-showcase', 'badge-tasks', 'badges/recent', 'badge-year-review', 'share-card', '/api/angel-gift']) {
    assert.doesNotMatch(allowlist, new RegExp(deferred.replaceAll('/', '\\/')), deferred)
  }
  assert.doesNotMatch(allowlist, /pathname\.startsWith\(['"]\/api\/users\/me\//)
  assert.doesNotMatch(allowlist, /pathname\.startsWith\(['"]\/api\/badge-/)
})

test('existing public Badge routes retain request auth and privacy filtering', () => {
  const badges = source('app/api/users/[userId]/badges/route.ts')
  const modules = source('app/api/users/[userId]/public-modules/route.ts')
  assert.match(badges, /resolveRequestAuth\(request\)/)
  assert.match(badges, /getProfileVisibility/)
  assert.match(modules, /resolveRequestAuth\(request\)/)
  assert.match(modules, /visibility: \{ not: 'SECRET'/)
  assert.match(modules, /resolveBadgeVisibility/)
})
