import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, test } from 'node:test'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'
import { authCookieName } from '../lib/auth-cookie'
import { normalizeStoredInternalPath } from '../lib/url-safety'

const TEST_SECRET = 'middleware-test-secret'
process.env.JWT_SECRET = TEST_SECRET

let middleware: typeof import('../middleware').middleware
before(async () => {
  ({ middleware } = await import('../middleware'))
})

async function createToken({
  secret = TEST_SECRET,
  id = 'user-1',
  role = 'USER',
  expiresAt = Math.floor(Date.now() / 1000) + 300,
  includeId = true,
}: Readonly<{
  secret?: string
  id?: string
  role?: string
  expiresAt?: number
  includeId?: boolean
}> = {}) {
  const payload = { role, ...(includeId ? { id } : {}) }
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret))
}

function makeRequest(path: string, token?: string | string[], host = 'ecfc.fans') {
  const tokens = Array.isArray(token) ? token : token ? [token] : []
  return new NextRequest(`https://${host}${path}`, tokens.length
    ? { headers: { cookie: tokens.map((value) => `${authCookieName}=${value}`).join('; ') } }
    : undefined)
}

function makeMutationRequest(path: string, method: string, auth: {
  cookie?: string
  bearer?: string
  origin?: string
  secFetchSite?: string
} = {}) {
  const headers = new Headers()
  if (auth.cookie) headers.set('cookie', `${authCookieName}=${auth.cookie}`)
  if (auth.bearer) headers.set('authorization', `Bearer ${auth.bearer}`)
  if (auth.origin) headers.set('origin', auth.origin)
  if (auth.secFetchSite) headers.set('sec-fetch-site', auth.secFetchSite)
  return new NextRequest(`https://ecfc.fans${path}`, { method, headers })
}

function getRedirect(response: Response) {
  assert.ok(response.status === 307 || response.status === 308)
  const location = response.headers.get('location')
  assert.ok(location)
  return new URL(location, 'https://ecfc.fans')
}

async function expectUnauthorizedApi(path: string) {
  const response = await middleware(makeRequest(path))
  assert.equal(response.status, 401)
  assert.match(response.headers.get('content-type') || '', /application\/json/)
  assert.deepEqual(await response.json(), {
    ok: false,
    code: 'UNAUTHENTICATED',
    message: '请先登录',
  })
}

test('未登录业务页面统一重定向到 login 并保留 next', async () => {
  for (const path of ['/', '/music', '/music/xxx', '/profile']) {
    const response = await middleware(makeRequest(path))
    const location = getRedirect(response)
    assert.equal(location.pathname, '/login')
    assert.equal(location.searchParams.get('next'), path)
  }
})

test('未登录敏感 API 返回 JSON 401，不重定向 HTML', async () => {
  await expectUnauthorizedApi('/api/music/songs/song-1/playback')
  await expectUnauthorizedApi('/api/notifications/unread-summary')
  await expectUnauthorizedApi('/api/posts')
  await expectUnauthorizedApi('/api/checkin')
})

test('Post Like 的 POST/DELETE 支持 Bearer，同时保留 Cookie 与匿名保护', async () => {
  const path = '/api/posts/test-post/like'
  for (const method of ['POST', 'DELETE']) {
    const bearerResponse = await middleware(makeMutationRequest(path, method, { bearer: 'middleware-test-bearer' }))
    assert.equal(bearerResponse.status, 200, `${method} Bearer reaches the route guard`)
  }

  for (const method of ['POST', 'DELETE']) {
    const anonymousResponse = await middleware(makeMutationRequest(path, method))
    assert.equal(anonymousResponse.status, 401, `anonymous ${method} remains blocked`)
  }

  const validCookie = await createToken()
  for (const method of ['POST', 'DELETE']) {
    const cookieResponse = await middleware(makeMutationRequest(path, method, { cookie: validCookie }))
    assert.equal(cookieResponse.status, 200, `Web Cookie ${method} remains authenticated`)
  }

  const unrelatedResponse = await middleware(makeMutationRequest('/api/admin/users', 'DELETE', { bearer: 'middleware-test-bearer' }))
  assert.equal(unrelatedResponse.status, 401, 'Bearer is not opened for unrelated protected DELETE routes')

  const route = readFileSync('app/api/posts/[postId]/like/route.ts', 'utf8')
  assert.match(route, /export async function DELETE[\s\S]*?requireRequestUser\(request\)/)
  assert.match(route, /where: \{ postId, userId: user\.id \}/)
})

test('Ecenter preferences preserves Cookie Origin checks and lets only its Bearer PATCH reach the auth handler', async () => {
  const path = '/api/users/me/e-center-preferences'
  const cookie = await createToken()

  const cookieGet = await middleware(makeMutationRequest(path, 'GET', {
    cookie,
    origin: 'https://ecfc.fans',
    secFetchSite: 'same-origin',
  }))
  assert.equal(cookieGet.status, 200)

  const bearerGet = await middleware(makeMutationRequest(path, 'GET', { bearer: 'test-bearer' }))
  assert.equal(bearerGet.status, 200, 'Bearer GET reaches the route auth guard')

  const anonymousGet = await middleware(makeMutationRequest(path, 'GET'))
  assert.equal(anonymousGet.status, 401)

  const cookiePatch = await middleware(makeMutationRequest(path, 'PATCH', {
    cookie,
    origin: 'https://ecfc.fans',
    secFetchSite: 'same-origin',
  }))
  assert.equal(cookiePatch.status, 200)

  const hostileCookiePatch = await middleware(makeMutationRequest(path, 'PATCH', {
    cookie,
    origin: 'https://evil.example',
    secFetchSite: 'cross-site',
  }))
  assert.equal(hostileCookiePatch.status, 403)
  assert.equal((await hostileCookiePatch.json()).code, 'CSRF_BLOCKED')

  const missingOriginCookiePatch = await middleware(makeMutationRequest(path, 'PATCH', { cookie }))
  assert.equal(missingOriginCookiePatch.status, 200, 'missing Origin retains existing hasValidRequestOrigin behavior')

  const bearerPatch = await middleware(makeMutationRequest(path, 'PATCH', { bearer: 'test-bearer' }))
  assert.equal(bearerPatch.status, 200, 'Bearer PATCH without Origin reaches the route auth guard')

  const hostileBearerPatch = await middleware(makeMutationRequest(path, 'PATCH', {
    bearer: 'test-bearer',
    origin: 'https://evil.example',
    secFetchSite: 'cross-site',
  }))
  assert.equal(hostileBearerPatch.status, 200, 'Bearer PATCH is not forced through browser CSRF; route auth remains authoritative')

  const anonymousPatch = await middleware(makeMutationRequest(path, 'PATCH'))
  assert.equal(anonymousPatch.status, 401)

  const route = readFileSync('app/api/users/me/e-center-preferences/route.ts', 'utf8')
  const patch = route.slice(route.indexOf('export async function PATCH'))
  assert.match(patch, /if \(!request\.headers\.has\('authorization'\)\)[\s\S]*rejectInvalidRequestOrigin\(request\)/)
  assert.match(patch, /requireRequestUser\(request\)/)

  const middlewareSource = readFileSync('middleware.ts', 'utf8')
  assert.match(middlewareSource, /const isEcenterPreferencesBearerPatch = request\.method === 'PATCH'[\s\S]*pathname === '\/api\/users\/me\/e-center-preferences'[\s\S]*mobileBearerBusinessRequest/)
  assert.match(middlewareSource, /!isEcenterPreferencesBearerPatch\s*&&\s*isCrossSiteRequest\(request\)/)
})

test('有效 JWT 可以访问 EasMusic，JWT 必须包含有效 user id', async () => {
  const valid = await createToken()
  const response = await middleware(makeRequest('/music', valid))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('location'), null)

  const missingId = await createToken({ includeId: false })
  const missingIdResponse = await middleware(makeRequest('/music', missingId))
  assert.equal(getRedirect(missingIdResponse).searchParams.get('next'), '/music')
})

test('ecfc.fans 与 www.ecfc.fans 都读取同一个共享会话 Cookie', async () => {
  const token = await createToken()

  for (const host of ['ecfc.fans', 'www.ecfc.fans']) {
    const response = await middleware(makeRequest('/music', token, host))
    assert.equal(response.status, 200, host)
    assert.equal(response.headers.get('location'), null, host)
  }
})

test('同名旧 Cookie 无效但共享域 Cookie 有效时，不误判为未登录', async () => {
  const valid = await createToken()
  const expired = await createToken({ expiresAt: Math.floor(Date.now() / 1000) - 1 })
  const response = await middleware(makeRequest('/music', [expired, valid]))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('location'), null)
})

test('过期、伪造和错误签名 JWT 都按未登录处理', async () => {
  const expired = await createToken({ expiresAt: Math.floor(Date.now() / 1000) - 1 })
  const forged = await createToken({ secret: 'wrong-secret' })

  for (const token of [expired, forged]) {
    const response = await middleware(makeRequest('/music', token))
    const location = getRedirect(response)
    assert.equal(location.pathname, '/login')
    assert.equal(location.searchParams.get('next'), '/music')
  }
})

test('认证页面和认证 API 保持公开，静态资源与上传资源保持公开', async () => {
  for (const path of ['/login', '/register', '/forgot-password', '/reset-password', '/user-agreement', '/api/auth/login', '/fonts/site.ttf', '/uploads/profile/avatar.png']) {
    const response = await middleware(makeRequest(path))
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('location'), null, path)
  }
})

test('middleware只确认登录，后台细粒度权限交给服务端 guard', async () => {
  const userToken = await createToken({ role: 'USER' })
  const pageResponse = await middleware(makeRequest('/admin', userToken))
  assert.equal(pageResponse.status, 200)
  assert.equal(pageResponse.headers.get('location'), null)

  const apiResponse = await middleware(makeRequest('/api/admin/users', userToken))
  assert.equal(apiResponse.status, 200)
  assert.equal(apiResponse.headers.get('location'), null)
  assert.match(readFileSync('components/AdminAccess.tsx', 'utf8'), /hasAdminPermission/)
})

test('管理员 JWT 可以通过 middleware 进入 admin 路由，登录 next 不允许外站或反斜杠', async () => {
  const adminToken = await createToken({ role: 'ADMIN' })
  const pageResponse = await middleware(makeRequest('/admin', adminToken))
  assert.equal(pageResponse.status, 200)

  const middlewareSource = readFileSync('middleware.ts', 'utf8')
  const loginSource = readFileSync('app/login/LoginForm.tsx', 'utf8')
  assert.match(middlewareSource, /jwtVerify\(token, jwtSecret, \{ algorithms: \['HS256'\] \}\)/)
  assert.match(middlewareSource, /payload\.id/)
  assert.match(loginSource, /normalizeStoredInternalPath/)
  assert.equal(normalizeStoredInternalPath('/admin'), '/admin')
  assert.equal(normalizeStoredInternalPath('//evil.example/admin'), null)
  assert.equal(normalizeStoredInternalPath('https://evil.example/admin'), null)
  assert.equal(normalizeStoredInternalPath('https://localhost:3000/admin'), '/admin')
})
