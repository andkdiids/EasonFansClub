import assert from 'node:assert/strict'
import test from 'node:test'
import { NextResponse } from 'next/server'
import {
  authCookieName,
  getSessionCookieDeletionOptions,
  getSessionCookieOptions,
  SESSION_MAX_AGE_SECONDS,
} from '../lib/auth'
import { POST as logoutPost } from '../app/api/auth/logout/route'

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

// sameSite 必须与 secure 保持一致（auth.ts 的唯一规则，避免写死字面量）：
// secure 为 true（生产/HTTPS）时使用 None（跨站/WebView 持久登录），否则使用 Lax。
function expectedSameSite(secure: boolean): 'none' | 'lax' {
  return secure ? 'none' : 'lax'
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
      // 生产环境恒为 secure，sameSite 必须为 None（不写死，跟随 secure 推导）
      assert.equal(options.secure, true)
      assert.equal(options.sameSite, expectedSameSite(options.secure))
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
    // 删除 Cookie 沿用同一套 sameSite 规则（生产为 None）
    assert.equal(options.sameSite, expectedSameSite(options.secure))
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
    // 开发环境非 secure，sameSite 必须为 Lax（不写死，跟随 secure 推导）
    assert.equal(options.sameSite, expectedSameSite(options.secure))
    assert.equal(options.path, '/')
    assert.equal(options.maxAge, SESSION_MAX_AGE_SECONDS)
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

    // 退出必须同时下发多条 Set-Cookie，清理三类同名 Cookie：
    // 正常 Domain=.ecfc.fans、历史 host-only、历史 www.ecfc.fans
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
      assert.match(cookie, /SameSite=None/)
    }
  } finally {
    if (previousNodeEnv === undefined) delete environment.NODE_ENV
    else environment.NODE_ENV = previousNodeEnv
  }
})
