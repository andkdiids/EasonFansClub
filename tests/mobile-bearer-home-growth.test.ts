import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(process.cwd())
const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')
const withoutComments = (value: string) => value.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

test('Home supports the shared optional Cookie/Bearer resolver without changing its payload or side effects', () => {
  const route = withoutComments(source('app/api/home/route.ts'))
  const middleware = source('middleware.ts')

  assert.match(route, /export async function GET\(request: Request\)/)
  assert.match(route, /const auth = await resolveRequestAuth\(request\)/)
  assert.match(route, /if \(auth\.response\) return auth\.response/)
  assert.match(route, /const user = auth\.user/)
  assert.doesNotMatch(route, /getCurrentUser\(/)
  for (const field of [
    'getHomeUserStats',
    'getHomeDailyMusicRecommendation',
    'getHomeDailyPrescriptionReward',
    'getHomeSiteStats',
    'getHomeTodayEvents',
    'getHomeAnywhereDoorLatest',
  ]) assert.match(route, new RegExp(field), field)
  assert.doesNotMatch(route, /issueEntertainmentDailyDraw|recordEntertainmentGameCompletion|PointLog|claimGrowthTask/)

  const getBlock = middleware.slice(
    middleware.indexOf("if (request.method === 'GET')"),
    middleware.indexOf("if (request.method === 'POST')"),
  )
  assert.match(getBlock, /pathname === '\/api\/home'/)
})

test('E院中心 read endpoint uses shared request auth and keeps server-side admin permission checks', () => {
  const route = withoutComments(source('app/api/users/me/e-center-preferences/route.ts'))
  const middleware = source('middleware.ts')

  assert.match(route, /export async function GET\(request: Request\)/)
  assert.match(route, /const guard = await requireRequestUser\(request\)/)
  assert.match(route, /export async function PATCH\(request: Request\)/)
  assert.equal((route.match(/requireRequestUser\(request\)/g) || []).length, 2)
  assert.doesNotMatch(route, /requireUser\(/)
  assert.match(route, /hasAdminPermission\(user\)/)
  assert.match(route, /getEcenterFeatureEditorState\(guard\.user\.id, await canAccessAdmin\(guard\.user\)\)/)
  assert.match(middleware, /pathname === '\/api\/users\/me\/e-center-preferences'/)
  assert.match(middleware, /request\.method === 'PATCH' && pathname === '\/api\/users\/me\/e-center-preferences'/)
  assert.doesNotMatch(middleware, /pathname\.startsWith\(['"]\/api\/users\/me\//)
})

test('Growth read and existing mutation endpoints use the shared request resolver', () => {
  const routes = [
    'app/api/growth/route.ts',
    'app/api/growth/refresh/route.ts',
    'app/api/growth/claim/route.ts',
    'app/api/growth/actions/share/route.ts',
  ]
  for (const file of routes) {
    const route = withoutComments(source(file))
    assert.match(route, /requireRequestUser\(request\)/, file)
    assert.doesNotMatch(route, /requireUser\(|getCurrentUser\(/, file)
  }

  const middleware = source('middleware.ts')
  const getBlock = middleware.slice(
    middleware.indexOf("if (request.method === 'GET')"),
    middleware.indexOf("if (request.method === 'POST')"),
  )
  const postBlock = middleware.slice(
    middleware.indexOf("if (request.method === 'POST')"),
    middleware.indexOf("if (request.method === 'PUT' || request.method === 'PATCH')"),
  )
  assert.match(getBlock, /pathname === '\/api\/growth'/)
  for (const path of ['/api/growth/refresh', '/api/growth/claim', '/api/growth/actions/share']) {
    assert.match(postBlock, new RegExp(path.replaceAll('/', '\\/')), path)
  }
})

test('Growth claim remains server-owned and preserves existing eligibility, idempotency and rate-limit boundaries', () => {
  const claim = withoutComments(source('app/api/growth/claim/route.ts'))
  const share = withoutComments(source('app/api/growth/actions/share/route.ts'))
  const service = withoutComments(source('lib/growth-tasks/service.ts'))

  assert.match(claim, /claimGrowthTask\(guard\.user\.id, taskCode\)/)
  assert.match(claim, /claimWeeklyMilestone\(guard\.user\.id, milestone\)/)
  assert.doesNotMatch(claim, /body\??\.(?:userId|uid|reward|progress|completedDays)/)
  assert.match(share, /enforceApiRateLimit\(request, guard\.user\.id/)
  assert.match(service, /if \(locked\.claimedAt\) return \{ claimed: false, reward: 0, alreadyClaimed: true \}/)
  assert.match(service, /const businessKey = stableBusinessKey\(\['claim', locked\.id\]\)/)
  assert.match(service, /businessKey,/)
  assert.match(service, /timezone: 'Asia\/Shanghai'/)
  assert.match(service, /WEEKLY_MILESTONES\.map/)
})

test('Bearer precedence remains strict for the newly compatible endpoints', () => {
  const security = source('lib/security.ts')
  assert.match(security, /if \(request\.headers\.has\('authorization'\)\)/)
  assert.match(security, /if \(!token\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(security, /const mobileAccess = await resolveMobileAccess\(request\)/)
  assert.match(security, /if \(!mobileAccess\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(security, /getCurrentUserById\(mobileAccess\.claims\.userId\)/)
})
