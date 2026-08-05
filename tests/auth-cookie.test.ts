import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { NextResponse } from 'next/server'
import {
  authCookieName,
  getSessionCookieDeletionOptions,
  getSessionCookieOptions,
  SESSION_MAX_AGE_SECONDS,
} from '../lib/auth-cookie'
import { POST as logoutPost } from '../app/api/auth/logout/route'
import { appendLegacyHostCookieDeletion } from '../lib/auth-session-cookie'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

function serializeSessionCookie(request: Request, value = 'session-token') {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(authCookieName, value, getSessionCookieOptions(request))
  return response.headers.get('set-cookie') || ''
}

function serializeDeletionCookie(request: Request) {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(authCookieName, '', getSessionCookieDeletionOptions(request))
  return response.headers.get('set-cookie') || ''
}

function withProductionEnvironment<T>(callback: () => T) {
  const environment = process.env as Record<string, string | undefined>
  const previousNodeEnv = environment.NODE_ENV
  environment.NODE_ENV = 'production'
  try {
    return callback()
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV
    else environment.NODE_ENV = previousNodeEnv
  }
}

function withDevelopmentEnvironment<T>(callback: () => T) {
  const environment = process.env as Record<string, string | undefined>
  const previousNodeEnv = environment.NODE_ENV
  delete environment.NODE_ENV
  try {
    return callback()
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV
    else environment.NODE_ENV = previousNodeEnv
  }
}

test('production proxy requests issue a persistent session cookie for both public hosts', () => {
  withProductionEnvironment(() => {
    for (const host of ['ecfc.fans', 'www.ecfc.fans']) {
      const request = new Request('http://next-internal:3000/api/auth/login', {
        headers: {
          'x-forwarded-host': host,
          'x-forwarded-proto': 'https',
        },
      })
      const cookie = serializeSessionCookie(request)
      const options = getSessionCookieOptions(request)

      assert.match(cookie, new RegExp(`^${authCookieName}=`))
      assert.match(cookie, /Domain=\.ecfc\.fans/)
      assert.match(cookie, /Path=\//)
      assert.match(cookie, /HttpOnly/)
      assert.match(cookie, /Secure/)
      // Production retains Secure + Lax and the persistent 30-day lifetime.
      assert.equal(options.secure, true)
      assert.equal(options.sameSite, 'lax')
      assert.match(cookie, new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}(?:;|$)`))
      assert.match(cookie, /Expires=/)
    }
  })
})

test('logout uses the same domain and path when clearing the session cookie', () => {
  withProductionEnvironment(() => {
    const request = new Request('http://next-internal:3000/api/auth/logout', {
      headers: {
        'x-forwarded-host': 'www.ecfc.fans',
        'x-forwarded-proto': 'https',
      },
    })
    const cookie = serializeDeletionCookie(request)
    const options = getSessionCookieDeletionOptions(request)

    assert.match(cookie, /Domain=\.ecfc\.fans/)
    assert.match(cookie, /Path=\//)
    // Deletion uses the same Lax/domain/path attributes.
    assert.equal(options.sameSite, 'lax')
    assert.match(cookie, /Max-Age=0(?:;|$)/)
    assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/)
  })
})

test('local development remains host-only, non-secure, and uses Lax SameSite', () => {
  withDevelopmentEnvironment(() => {
    const request = new Request('http://localhost:3000/api/auth/login')
    const options = getSessionCookieOptions(request)

    assert.equal(options.domain, undefined)
    assert.equal(options.secure, false)
    // Local development remains host-only, non-secure, and Lax.
    assert.equal(options.sameSite, 'lax')
    assert.equal(options.path, '/')
    assert.equal(options.maxAge, SESSION_MAX_AGE_SECONDS)
  })
})

test('preview hosts remain host-only instead of receiving an invalid ecfc.fans Domain', () => {
  const request = new Request('https://preview.example.workers.dev/api/auth/login')
  const options = getSessionCookieOptions(request)

  assert.equal(options.domain, undefined)
  assert.equal(options.secure, true)
  assert.equal(options.sameSite, 'lax')
})

test('HTTPS request on a non-production environment still issues a Secure SameSite=Lax cookie', () => {
  // Regression coverage: HTTPS must not downgrade the persistent cookie attributes.
  withDevelopmentEnvironment(() => {
    const request = new Request('http://next-internal:3000/api/auth/login', {
      headers: {
        'x-forwarded-host': 'ecfc.fans',
        'x-forwarded-proto': 'https',
      },
    })
    const cookie = serializeSessionCookie(request)
    const options = getSessionCookieOptions(request)

    assert.equal(options.secure, true)
    assert.equal(options.sameSite, 'lax')
    assert.match(cookie, /Secure/)
    // Next serializes the Lax attribute case-insensitively.
    assert.match(cookie, /SameSite=lax/i)
    assert.match(cookie, /Domain=\.ecfc\.fans/)
  })
})

test('logout emits multiple Set-Cookie entries clearing domain, host-only and www legacy cookies', async () => {
  const environment = process.env as Record<string, string | undefined>
  const previousNodeEnv = environment.NODE_ENV
  environment.NODE_ENV = 'production'
  try {
    const request = new Request('http://next-internal:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        'x-forwarded-host': 'ecfc.fans',
        'x-forwarded-proto': 'https',
        accept: 'application/json',
      },
    })
    const response = await logoutPost(request)
    const setCookies = response.headers.getSetCookie()

    // 退出时同时清理共享 domain、当前 host-only 和历史 www domain 变体。
    assert.ok(setCookies.length >= 3, `expected >=3 Set-Cookie on logout, got ${setCookies.length}: ${JSON.stringify(setCookies)}`)

    const hasDomainEcfc = setCookies.some((c) => /Domain=\.ecfc\.fans(?:;|$)/.test(c))
    const hasHostOnly = setCookies.some((c) => /^eason_fans_session=/.test(c) && !/Domain=/.test(c))
    const hasWww = setCookies.some((c) => /Domain=www\.ecfc\.fans(?:;|$)/.test(c))

    assert.ok(hasDomainEcfc, 'missing .ecfc.fans deletion')
    assert.ok(hasHostOnly, 'missing host-only deletion')
    assert.ok(hasWww, 'missing www.ecfc.fans deletion')

    for (const cookie of setCookies) {
      assert.match(cookie, /Path=\//)
      assert.match(cookie, /Max-Age=0(?:;|$)/)
      assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/)
      assert.match(cookie, /HttpOnly/)
      assert.match(cookie, /Secure/)
      assert.match(cookie, /SameSite=Lax/)
    }
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV
    else environment.NODE_ENV = previousNodeEnv
  }
})

test('login and registration share the persistent cookie options and heal legacy host-only cookies', () => {
  for (const route of ['app/api/auth/login/route.ts', 'app/api/auth/register/route.ts']) {
    const content = source(route)
    assert.match(content, /getSessionCookieOptions/)
    assert.match(content, /appendLegacyHostCookieDeletion/)
    assert.doesNotMatch(content, /(?:login_token|auth_token)/)
  }
})

test('legacy host-only cleanup keeps the domain cookie untouched', () => {
  const request = new Request('https://ecfc.fans/api/auth/login')
  const response = NextResponse.json({ ok: true })
  response.cookies.set(authCookieName, 'new-session-token', getSessionCookieOptions(request))
  appendLegacyHostCookieDeletion(response, request)

  const headers = response.headers.getSetCookie()
  assert.equal(headers.length, 2)
  const persistent = headers.find((header) => /Domain=\.ecfc\.fans(?:;|$)/.test(header))
  const legacyDeletion = headers.find((header) => !/Domain=/.test(header))

  assert.ok(persistent)
  assert.match(persistent, /^eason_fans_session=new-session-token/)
  assert.match(persistent, new RegExp(`Max-Age=${SESSION_MAX_AGE_SECONDS}(?:;|$)`))
  assert.ok(legacyDeletion)
  assert.match(legacyDeletion, /^eason_fans_session=/)
  assert.match(legacyDeletion, /Path=\//)
  assert.match(legacyDeletion, /Max-Age=0(?:;|$)/)
  assert.match(legacyDeletion, /SameSite=Lax/)
})

test('the client bootstrap validates the HttpOnly session with /api/auth/me', () => {
  assert.match(source('app/api/auth/me/route.ts'), /getCurrentUser\(\)/)
  assert.match(source('components/AuthSessionRestore.tsx'), /fetch\('\/api\/auth\/me'/)
  assert.match(source('app/layout.tsx'), /<AuthSessionRestore initialUserId=/)
})
