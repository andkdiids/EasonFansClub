import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { SignJWT } from 'jose'
import {
  consumeMobileRefreshSession,
  createMobileAccessToken,
  hashRefreshToken,
  InvalidMobileRefreshTokenError,
  MOBILE_ACCESS_TOKEN_AUDIENCE,
  MOBILE_ACCESS_TOKEN_ISSUER,
  MOBILE_ACCESS_TOKEN_TTL_SECONDS,
  MOBILE_ACCESS_TOKEN_TYPE,
  MOBILE_REFRESH_TOKEN_TTL_SECONDS,
  verifyMobileAccessToken,
} from '../lib/mobile-auth'

const root = join(process.cwd())
const source = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8')

test('mobile auth routes are Bearer/refresh-token endpoints and do not set Web cookies', () => {
  const login = source('app/api/mobile/auth/login/route.ts')
  const me = source('app/api/mobile/auth/me/route.ts')
  const refresh = source('app/api/mobile/auth/refresh/route.ts')
  const logout = source('app/api/mobile/auth/logout/route.ts')
  const webLogin = source('app/api/auth/login/route.ts')

  assert.match(login, /issueMobileSession/)
  assert.match(me, /resolveMobileAccess/)
  assert.match(refresh, /rotateMobileRefreshToken/)
  assert.match(logout, /revokeMobileSession/)
  for (const route of [login, me, refresh, logout]) {
    assert.doesNotMatch(route, /authCookieName|response\.cookies\.set|createSessionToken/)
  }
  assert.match(webLogin, /createSessionToken\(sessionUser\)/)
  assert.match(webLogin, /response\.cookies\.set\(authCookieName/)
})

test('mobile access tokens enforce signature, expiry, issuer, audience, and typ', async () => {
  const previousSecret = process.env.MOBILE_ACCESS_TOKEN_SECRET
  process.env.MOBILE_ACCESS_TOKEN_SECRET = 'test-mobile-access-token-secret-with-32-bytes'
  try {
    const token = await createMobileAccessToken('user-1', 'session-1')
    assert.deepEqual(await verifyMobileAccessToken(token), { userId: 'user-1', sessionId: 'session-1' })
    assert.equal(await verifyMobileAccessToken(`${token}tampered`), null)

    const secretValue = process.env.MOBILE_ACCESS_TOKEN_SECRET as string
    const secret = new TextEncoder().encode(secretValue)
    const base = new SignJWT({ sid: 'session-1', typ: MOBILE_ACCESS_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('user-1')
      .setIssuer(MOBILE_ACCESS_TOKEN_ISSUER)
      .setAudience(MOBILE_ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt()

    const expired = await base.setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(secret)
    assert.equal(await verifyMobileAccessToken(expired), null)

    const wrongIssuer = await new SignJWT({ sid: 'session-1', typ: MOBILE_ACCESS_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('user-1')
      .setIssuer('wrong-issuer')
      .setAudience(MOBILE_ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secret)
    assert.equal(await verifyMobileAccessToken(wrongIssuer), null)

    const wrongAudience = await new SignJWT({ sid: 'session-1', typ: MOBILE_ACCESS_TOKEN_TYPE })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('user-1')
      .setIssuer(MOBILE_ACCESS_TOKEN_ISSUER)
      .setAudience('wrong-audience')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secret)
    assert.equal(await verifyMobileAccessToken(wrongAudience), null)

    const wrongType = await new SignJWT({ sid: 'session-1', typ: 'web_cookie' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('user-1')
      .setIssuer(MOBILE_ACCESS_TOKEN_ISSUER)
      .setAudience(MOBILE_ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(secret)
    assert.equal(await verifyMobileAccessToken(wrongType), null)
  } finally {
    if (previousSecret === undefined) delete process.env.MOBILE_ACCESS_TOKEN_SECRET
    else process.env.MOBILE_ACCESS_TOKEN_SECRET = previousSecret
  }
})

test('refresh tokens are high-entropy opaque values and only hashes cross the storage boundary', () => {
  const raw = 'opaque-refresh-token-value'
  const hash = hashRefreshToken(raw)
  assert.equal(hash.length, 64)
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.notEqual(hash, raw)
  assert.equal(MOBILE_ACCESS_TOKEN_TTL_SECONDS, 15 * 60)
  assert.equal(MOBILE_REFRESH_TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60)
})

test('refresh compare-and-swap allows only one concurrent consumer', async () => {
  let storedHash = 'old-hash'
  const session = {
    id: 'session-1',
    userId: 'user-1',
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
  }
  const store = {
    async findByRefreshTokenHash(hash: string) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return hash === storedHash ? session : null
    },
    async updateRefreshToken(input: { id: string; expectedRefreshTokenHash: string; refreshTokenHash: string }) {
      if (input.id !== session.id || input.expectedRefreshTokenHash !== storedHash) return 0
      storedHash = input.refreshTokenHash
      return 1
    },
  }
  const input = {
    oldHash: 'old-hash',
    newHash: 'new-hash',
    now: new Date(),
    newExpiresAt: new Date(Date.now() + 60_000),
  }

  const results = await Promise.allSettled([
    consumeMobileRefreshSession(store, input),
    consumeMobileRefreshSession(store, input),
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  const rejected = results.find((result) => result.status === 'rejected')
  assert.ok(rejected && rejected.reason instanceof InvalidMobileRefreshTokenError)
})

test('expired, revoked, and unknown refresh sessions share the invalid-token result', async () => {
  const now = new Date()
  const cases = [
    null,
    { id: 'expired', userId: 'user-1', expiresAt: new Date(now.getTime() - 1), revokedAt: null },
    { id: 'revoked', userId: 'user-1', expiresAt: new Date(now.getTime() + 60_000), revokedAt: now },
  ]

  for (const record of cases) {
    let updateCalled = false
    const store = {
      async findByRefreshTokenHash() {
        return record
      },
      async updateRefreshToken() {
        updateCalled = true
        return 1
      },
    }
    await assert.rejects(
      consumeMobileRefreshSession(store, {
        oldHash: 'unknown-hash',
        newHash: 'next-hash',
        now,
        newExpiresAt: new Date(now.getTime() + 60_000),
      }),
      InvalidMobileRefreshTokenError,
    )
    assert.equal(updateCalled, false)
  }
})

test('logout revocation is scoped to the matching mobile session and never uses the Web cookie route', () => {
  const service = source('lib/mobile-auth.ts')
  const mobileLogout = source('app/api/mobile/auth/logout/route.ts')
  assert.match(service, /where\.id = input\.sessionId/)
  assert.match(service, /where\.refreshTokenHash = hashRefreshToken\(input\.refreshToken\)/)
  assert.match(service, /revokedAt: null/)
  assert.doesNotMatch(mobileLogout, /authCookieName|response\.cookies\.set|appendLegacyHostCookieDeletion/)
})

test('migration is additive and excludes destructive SQL', () => {
  const migration = source('prisma/migrations/20260920120000_add_mobile_auth_sessions/migration.sql')
  assert.match(migration, /CREATE TABLE `MobileAuthSession`/)
  assert.match(migration, /refreshTokenHash/)
  assert.match(migration, /FOREIGN KEY \(`userId`\)/)
  const executableSql = migration.replace(/ON UPDATE CASCADE/gi, '')
  assert.doesNotMatch(executableSql, /\bDROP TABLE\b|\bDELETE FROM\b|\bUPDATE\s+[`A-Za-z]/i)
})

test('shared login credentials and rate limits are used by Web and Mobile', () => {
  const credentials = source('lib/auth-credentials.ts')
  const webLogin = source('app/api/auth/login/route.ts')
  const mobileLogin = source('app/api/mobile/auth/login/route.ts')
  const middleware = source('middleware.ts')
  assert.match(credentials, /findCompleteUserByLoginIdentifier/)
  assert.match(credentials, /limit: 20, windowSeconds: 10 \* 60/)
  assert.match(credentials, /limit: 8, windowSeconds: 10 \* 60/)
  assert.match(webLogin, /authenticateLoginCredentials/)
  assert.match(mobileLogin, /authenticateLoginCredentials/)
  assert.match(middleware, /'\/api\/mobile\/auth\/'/)
  assert.match(middleware, /!isMobileAuthPath && isCrossSiteRequest/)
})

test('mobile community Bearer endpoints are explicitly allowlisted before Cookie middleware', () => {
  const middleware = source('middleware.ts')
  assert.match(middleware, /function isMobileBearerBusinessRequest\(/)
  for (const pattern of [
    /\/api\/forum\/discover/,
    /posts.*replies/,
    /posts.*like/,
    /replies.*like/,
    /\/api\/notifications\/read-all/,
    /notifications.*read/,
    /\/api\/notifications\/unread-count/,
    /\/api\/topics/,
  ]) {
    assert.match(middleware, pattern)
  }
  assert.match(middleware, /isMobileBearerBusinessRequest\(request, pathname\)/)
})

test('Phase 4 routes use the shared request resolver and never trust body identity fields', () => {
  const routeFiles = [
    'app/api/posts/route.ts',
    'app/api/posts/draft/route.ts',
    'app/api/uploads/content-image/route.ts',
    'app/api/search/route.ts',
    'app/api/users/me/route.ts',
    'app/api/users/[userId]/public-modules/route.ts',
    'app/api/users/[userId]/badges/route.ts',
    'app/api/users/[userId]/post-groups/route.ts',
    'app/api/friends/list/route.ts',
    'app/api/friends/requests/route.ts',
    'app/api/friends/requests/received/route.ts',
    'app/api/friends/requests/sent/route.ts',
    'app/api/friends/requests/[requestId]/route.ts',
    'app/api/friends/requests/[requestId]/accept/route.ts',
    'app/api/friends/requests/[requestId]/reject/route.ts',
    'app/api/friends/[userId]/route.ts',
    'app/api/friends/[userId]/group/route.ts',
    'app/api/friend-groups/route.ts',
    'app/api/friend-groups/[groupId]/route.ts',
  ]
  for (const file of routeFiles) {
    const route = source(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.match(route, /requireRequestUser\(request\)|resolveRequestAuth\(request\)/, file)
    assert.doesNotMatch(route, /requireUser\(|getCurrentUser\(/, file)
    assert.doesNotMatch(route, /(?:authorId|senderId|requesterId|ownerId)\s*:\s*(?:body|request|input)/, file)
  }
})

test('Phase 4 Bearer middleware matrix covers every native method family', () => {
  const middleware = source('middleware.ts')
  const block = (method: string) => {
    const start = middleware.indexOf("if (request.method === '" + method + "')")
    assert.notEqual(start, -1, method)
    const next = middleware.indexOf("\n  if (request.method === '", start + 1)
    return middleware.slice(start, next === -1 ? middleware.length : next)
  }

  const get = block('GET')
  for (const path of ['/api/posts/draft', '/api/boards', '/api/search', '/api/users/me', '/api/friends/list', '/api/friend-groups']) {
    assert.match(get, new RegExp(path.replaceAll('/', '\\/')))
  }
  for (const pattern of ['public-modules', 'badges', 'post-groups', 'friends/requests/received', 'friends/requests/sent']) {
    assert.match(get, new RegExp(pattern))
  }

  const post = block('POST')
  for (const path of ['/api/posts', '/api/uploads/content-image', '/api/friends/requests', '/api/friend-groups']) {
    assert.match(post, new RegExp(path.replaceAll('/', '\\/')))
  }
  assert.match(post, /accept\|reject/)

  const updateStart = middleware.indexOf("if (request.method === 'PUT' || request.method === 'PATCH')")
  assert.notEqual(updateStart, -1, 'PUT/PATCH')
  const updateEnd = middleware.indexOf("\n  if (request.method === 'DELETE')", updateStart + 1)
  const update = middleware.slice(updateStart, updateEnd === -1 ? middleware.length : updateEnd)
  assert.match(update, /request\.method === 'PATCH'/)
  for (const path of ['/api/posts/draft', '/api/users/me', 'friends', 'friend-groups']) {
    assert.match(update, new RegExp(path.replaceAll('/', '\\/')))
  }
  const remove = block('DELETE')
  for (const path of ['/api/posts/draft', 'friends', 'friend-groups']) {
    assert.match(remove, new RegExp(path.replaceAll('/', '\\/')))
  }
  const postLikeRule = String.raw`/^\/api\/posts\/[^/]+\/like$/.test(pathname)`
  assert.ok(post.includes(postLikeRule))
  assert.ok(remove.includes(postLikeRule))
})

test('Bearer identity wins over Cookie identity and invalid Bearer never falls back', () => {
  const security = source('lib/security.ts')
  const middleware = source('middleware.ts')
  assert.match(security, /if \(request\.headers\.has\('authorization'\)\)/)
  assert.match(security, /const token = getBearerToken\(request\.headers\.get\('authorization'\)\)/)
  assert.match(security, /if \(!token\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(security, /const mobileAccess = await resolveMobileAccess\(request\)/)
  assert.match(security, /if \(!mobileAccess\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(security, /getCurrentUserById\(mobileAccess\.claims\.userId\)/)
  assert.match(middleware, /!isMobileAuthPath && isCrossSiteRequest\(request\)/)
  assert.doesNotMatch(middleware, /Access-Control-Allow-Origin\s*:\s*\*|allow-origin.*\*/)
})
