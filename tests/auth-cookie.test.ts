import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse } from 'next/server'
import {
  authCookieName,
  getSessionCookieDeletionOptions,
  getSessionCookieOptions,
  SESSION_MAX_AGE_SECONDS,
} from '../lib/auth'

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

      assert.match(cookie, new RegExp(`^${authCookieName}=`))
      assert.match(cookie, /Domain=\.ecfc\.fans/)
      assert.match(cookie, /Path=\//)
      assert.match(cookie, /HttpOnly/)
      assert.match(cookie, /Secure/)
      assert.match(cookie, /SameSite=lax/i)
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

    assert.match(cookie, /Domain=\.ecfc\.fans/)
    assert.match(cookie, /Path=\//)
    assert.match(cookie, /Max-Age=0(?:;|$)/)
    assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/)
  })
})

test('local development remains host-only and does not use the production domain', () => {
  const request = new Request('http://localhost:3000/api/auth/login')
  const options = getSessionCookieOptions(request)

  assert.equal(options.domain, undefined)
  assert.equal(options.secure, false)
  assert.equal(options.path, '/')
  assert.equal(options.sameSite, 'lax')
  assert.equal(options.maxAge, SESSION_MAX_AGE_SECONDS)
})
