import { SignJWT, jwtVerify, errors as joseErrors, type JWTPayload } from 'jose'
import { NextResponse, type NextRequest } from 'next/server'
import { authCookieName, getSessionCookieOptions, SESSION_MAX_AGE_SECONDS } from '@/lib/auth-cookie'
import { buildPublicAbsoluteUrl, getPublicOrigin, isLocalHostname, safeInternalPath } from '@/lib/url-safety'
import { isCrossSiteRequest, isStateChangingMethod } from '@/lib/csrf'
const noStoreValue = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
const immutableCacheValue = 'public, max-age=31536000, immutable'
const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-before-production')

// 滚动续期：JWT 剩余有效期不足该阈值时重签 cookie（仍沿用 30 天有效期）。
// 用户持续活跃（长时间停留在想听/听听等 SPA 页面持续请求）不会因固定过期掉登录。
const ROLLING_RENEW_BEFORE_MS = 15 * 24 * 60 * 60 * 1000

const publicExactPaths = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/user-agreement',
  '/favicon.ico',
  '/icon.png',
  '/apple-icon.png',
  '/robots.txt',
  '/manifest.webmanifest',
  '/d89ed4255676640e037130589550e237.txt',
  '/clinic',
  '/salon',
  '/activities',
  '/api/clinic',
  '/api/mobile/config',
  '/api/salon/posts',
  '/api/salon/options',
  '/api/share/wechat-logo-v2.png',
])

const immutablePublicExactPaths = new Set([
  '/api/share/wechat-logo-v2.png',
])

const publicPathPrefixes = [
  '/api/auth/',
  '/api/mobile/auth/',
  '/api/mobile/beta/',
  '/api/health/',
  '/_next/',
  '/easmusic/',
  '/images/',
  '/fonts/',
  '/uploads/',
  '/icons/',
  '/clinic/',
  '/api/clinic/',
]

// These endpoints perform their own gateway, ticket, and database checks.
// They must bypass the generic browser-session middleware because the media
// gateway deliberately does not forward the user's Cookie to the origin.
const guessSongMediaGatewayPaths = new Set([
  '/api/internal/media/guess-song/authorize',
  '/api/internal/media/guess-song/origin',
])

const immutablePublicPathPrefixes = [
  '/easmusic/',
  '/images/cassette/',
]

type VerifiedSession = {
  id: string
  role: string | null
  needsRollingRenew: boolean
  token: string
}

async function renewSessionCookie(request: NextRequest, currentToken: string) {
  try {
    const { payload } = await jwtVerify(currentToken, jwtSecret, { algorithms: ['HS256'] })
    const token = await new SignJWT(payload as unknown as JWTPayload)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
      .sign(jwtSecret)
    return { token, options: getSessionCookieOptions(request) }
  } catch (error) {
    // Refresh is best-effort. Never clear the old cookie here: a concurrent
    // request may still be using it, and a refresh failure is not proof that
    // the existing session is invalid.
    console.warn('[AUTH_SESSION_RENEWAL]', JSON.stringify({
      reason: 'RENEWAL_FAILED',
      path: request.nextUrl.pathname,
      method: request.method,
      hostname: request.nextUrl.hostname,
      errorName: error instanceof Error ? error.name : 'unknown',
      at: new Date().toISOString(),
    }))
    return null
  }
}

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set('Cache-Control', noStoreValue)
  response.headers.set('CDN-Cache-Control', 'no-store')
  response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
  return response
}

function withImmutableCacheHeaders(response: NextResponse) {
  response.headers.set('Cache-Control', immutableCacheValue)
  response.headers.set('CDN-Cache-Control', immutableCacheValue)
  response.headers.set('Cloudflare-CDN-Cache-Control', immutableCacheValue)
  return response
}

function normalizeHost(value: string) {
  const host = value.trim().toLowerCase()
  if (host.startsWith('[')) return host.slice(1, host.indexOf(']'))
  return host.replace(/:\d+$/, '')
}

function isPublicPath(pathname: string) {
  if (publicExactPaths.has(pathname)) return true
  if (pathname === '/api/auth') return true
  if (publicPathPrefixes.some((prefix) => pathname.startsWith(prefix))) return true
  if (/^\/api\/(?:posts|activities)\/[^/]+\/share-card$/.test(pathname)) return true
  if (/^\/api\/salon\/posts\/[^/]+\/share-card$/.test(pathname)) return true
  if (/^\/api\/material-redemptions\/[^/]+\/share-card$/.test(pathname)) return true
  if (/^\/api\/material-redemptions\/(?!me$|reference-search$)[^/]+$/.test(pathname)) return true
  if (/^\/api\/salon\/media\/[^/]+\/original$/.test(pathname)) return true
  if (/^\/api\/salon\/posts\/[^/]+\/view$/.test(pathname)) return true
  // Public detail pages must be reachable by WeChat and other crawlers. The
  // nested create/edit/register routes remain protected by their page/API
  // guards because they do not match these exact one-segment detail paths.
  if (/^\/posts\/(?!new$)[^/]+$/.test(pathname)) return true
  if (/^\/salon\/[^/]+$/.test(pathname)) return true
  if (/^\/material-redemptions\/(?!me$)[^/]+$/.test(pathname)) return true
  if (/^\/api\/salon\/posts\/[^/]+\/comments$/.test(pathname)) return true
  if (/^\/api\/salon\/posts\/[^/]+$/.test(pathname)) return true
  return /^\/activities\/[^/]+$/.test(pathname)
}

function isImmutablePublicPath(pathname: string) {
  return immutablePublicExactPaths.has(pathname) || immutablePublicPathPrefixes.some((prefix) => pathname.startsWith(prefix))
}

function isMobileBearerBusinessRequest(request: NextRequest, pathname: string) {
  if (!/^Bearer\s+/i.test(request.headers.get('authorization') || '')) return false
  if (request.method === 'GET') {
    return pathname === '/api/posts'
      || pathname === '/api/checkin'
      || pathname === '/api/checkin/history'
      || /^\/api\/checkin\/history\/[^/]+$/.test(pathname)
      || pathname === '/api/entertainment/daily-draw'
      || pathname === '/api/entertainment/daily-draw/history'
      || pathname === '/api/points/today'
      || pathname === '/api/points/history'
      || pathname === '/api/entertainment/guess-song/sessions'
      || /^\/api\/entertainment\/guess-song\/sessions\/[^/]+$/.test(pathname)
      || /^\/api\/entertainment\/guess-song\/sessions\/[^/]+\/audio$/.test(pathname)
      || pathname === '/api/entertainment/guess-song/search'
      || pathname === '/api/entertainment/guess-song/leaderboard'
      || pathname === '/api/entertainment/leaderboard'
      || pathname === '/api/entertainment/forget-lyrics'
      || pathname === '/api/users/me/badges'
      || /^\/api\/users\/me\/badges\/[^/]+$/.test(pathname)
      || /^\/api\/badge-series\/[^/]+$/.test(pathname)
      || /^\/api\/posts\/[^/]+$/.test(pathname)
      || /^\/api\/posts\/[^/]+\/replies$/.test(pathname)
      || /^\/api\/posts\/[^/]+\/like$/.test(pathname)
      || /^\/api\/replies\/[^/]+\/like$/.test(pathname)
      || pathname === '/api/notifications'
      || pathname === '/api/notifications/unread-count'
      || pathname === '/api/topics'
      || /^\/api\/topics\/[^/]+$/.test(pathname)
      || pathname === '/api/posts/draft'
      || pathname === '/api/boards'
      || pathname === '/api/search'
      || pathname === '/api/users/me'
      || /^\/api\/users\/[^/]+\/public-modules$/.test(pathname)
      || /^\/api\/users\/[^/]+\/badges$/.test(pathname)
      || /^\/api\/users\/[^/]+\/(?:relationship|followers|following)$/.test(pathname)
      || pathname === '/api/direct-conversations'
      || /^\/api\/direct-conversations\/[^/]+\/messages$/.test(pathname)
      || /^\/api\/posts\/[^/]+\/share$/.test(pathname)
      || /^\/api\/material-redemptions\/[^/]+\/share$/.test(pathname)
      || /^\/api\/users\/[^/]+\/post-groups$/.test(pathname)
      || pathname === '/api/friends/list'
      || pathname === '/api/friends/requests/received'
      || pathname === '/api/friends/requests/sent'
      || pathname === '/api/friend-groups'
  }
  if (request.method === 'POST') {
    return pathname === '/api/forum/discover'
      || pathname === '/api/checkin'
      || pathname === '/api/entertainment/daily-draw'
      || pathname === '/api/entertainment/guess-song/sessions'
      || /^\/api\/entertainment\/guess-song\/sessions\/[^/]+\/(?:play|answer|pause|resume|abandon)$/.test(pathname)
      || pathname === '/api/users/me/badge/equip'
      || /^\/api\/users\/[^/]+\/follow$/.test(pathname)
      || pathname === '/api/direct-conversations'
      || /^\/api\/direct-conversations\/[^/]+\/messages$/.test(pathname)
      || /^\/api\/direct-conversations\/[^/]+\/(?:read|pin|clear)$/.test(pathname)
      || /^\/api\/direct-conversations\/[^/]+\/messages\/[^/]+\/recall$/.test(pathname)
      || /^\/api\/posts\/[^/]+\/share$/.test(pathname)
      || /^\/api\/material-redemptions\/[^/]+\/share$/.test(pathname)
      || pathname === '/api/posts'
      || pathname === '/api/uploads/content-image'
      || pathname === '/api/friends/requests'
      || /^\/api\/friends\/requests\/[^/]+\/(?:accept|reject)$/.test(pathname)
      || pathname === '/api/friend-groups'
      || /^\/api\/posts\/[^/]+\/replies$/.test(pathname)
      || /^\/api\/posts\/[^/]+\/like$/.test(pathname)
      || /^\/api\/replies\/[^/]+\/like$/.test(pathname)
      || pathname === '/api/notifications/read-all'
      || /^\/api\/notifications\/[^/]+\/read$/.test(pathname)
  }
  if (request.method === 'PUT' || request.method === 'PATCH') {
    return pathname === '/api/posts/draft'
      || (request.method === 'PUT' && pathname === '/api/users/me/badge/equip')
      || pathname === '/api/users/me'
      || /^\/api\/friends\/requests\/[^/]+$/.test(pathname)
      || /^\/api\/friends\/[^/]+\/group$/.test(pathname)
      || /^\/api\/friend-groups\/[^/]+$/.test(pathname)
      || pathname === '/api/notifications'
      || /^\/api\/posts\/[^/]+\/like$/.test(pathname)
      || /^\/api\/replies\/[^/]+\/like$/.test(pathname)
  }
  if (request.method === 'DELETE') {
    return pathname === '/api/posts/draft'
      || pathname === '/api/users/me/badge/equip'
      || /^\/api\/users\/[^/]+\/follow$/.test(pathname)
      || /^\/api\/posts\/[^/]+\/like$/.test(pathname)
      || /^\/api\/friends\/[^/]+$/.test(pathname)
      || /^\/api\/friend-groups\/[^/]+$/.test(pathname)
  }
  if (request.method === 'HEAD') {
    return /^\/api\/entertainment\/guess-song\/sessions\/[^/]+\/audio$/.test(pathname)
  }
  return false
}

function isApiPath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

type SessionVerification = {
  session: VerifiedSession | null
  internalError: boolean
  reason?: 'NO_SESSION' | 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'VERIFY_FAILED'
}

async function verifyRequestSession(request: NextRequest): Promise<SessionVerification> {
  // 可能同时存在 Domain=.ecfc.fans 与 host-only 两个同名 cookie
  // （多 host 访问 + 滚动续期种下）。逐个验证，只要一个有效即视为已登录，
  // 避免取到旧/失效 cookie 被误判未登录。
  const tokens = request.cookies.getAll(authCookieName).map((cookie) => cookie.value)
  if (!tokens.length) {
    // 无 Cookie：页面访客走 loginRedirect（已有 [auth.redirect] 日志），
    // 这里补充 API 场景的 NO_COOKIE 诊断。
    if (isApiPath(request.nextUrl.pathname)) {
      console.warn('[AUTH_SESSION_INVALID]', JSON.stringify({
        reason: 'NO_COOKIE',
        path: request.nextUrl.pathname,
        method: request.method,
        hostname: request.nextUrl.hostname,
        userAgent: request.headers.get('user-agent')?.slice(0, 200) || undefined,
      }))
    }
    return { session: null, internalError: false, reason: 'NO_SESSION' }
  }

  let internalError = false
  const reasons: Array<NonNullable<SessionVerification['reason']>> = []
  for (const token of tokens) {
    const result = await tryVerifyToken(token, request)
    if (result.session) return { session: result.session, internalError: false }
    internalError = internalError || result.internalError
    if (result.reason) reasons.push(result.reason)
  }
  const reason = internalError
    ? 'VERIFY_FAILED'
    : reasons.includes('TOKEN_EXPIRED')
      ? 'TOKEN_EXPIRED'
      : 'TOKEN_INVALID'
  return { session: null, internalError, reason }
}

type TokenVerifyResult = {
  session: VerifiedSession | null
  internalError: boolean
  reason?: 'TOKEN_EXPIRED' | 'TOKEN_INVALID' | 'VERIFY_FAILED'
}

async function tryVerifyToken(token: string, request: NextRequest): Promise<TokenVerifyResult> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
    if (typeof payload.id !== 'string' || !payload.id.trim()) {
      await logSessionInvalid('PAYLOAD_INVALID', request, token)
      return { session: null, internalError: false, reason: 'TOKEN_INVALID' }
    }
    const exp = typeof payload.exp === 'number' ? payload.exp : 0
    const remainingMs = exp * 1000 - Date.now()
    return {
      session: {
        id: payload.id,
        role: typeof payload.role === 'string' ? payload.role : null,
        token,
        // 剩余有效期不足阈值且尚未过期 → 需要滚动续期
        needsRollingRenew: remainingMs > 0 && remainingMs < ROLLING_RENEW_BEFORE_MS,
      },
      internalError: false,
    }
  } catch (error) {
    // 明确区分「已过期」与「签名/格式错误」。JOSE 自身的错误属于用户
    // Cookie 无效；非 JOSE 的未知异常属于认证服务内部故障，不能返回 401。
    if (error instanceof joseErrors.JWTExpired) {
      await logSessionInvalid('SESSION_EXPIRED', request, token)
      return { session: null, internalError: false, reason: 'TOKEN_EXPIRED' }
    }
    if (error instanceof joseErrors.JOSEError) {
      await logSessionInvalid('INVALID_SIGNATURE', request, token)
      return { session: null, internalError: false, reason: 'TOKEN_INVALID' }
    }
    await logSessionInvalid('VERIFICATION_ERROR', request, token)
    return { session: null, internalError: true, reason: 'VERIFY_FAILED' }
  }
}

async function sessionTokenFingerprint(token: string) {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('').slice(0, 16)
  } catch {
    return 'unavailable'
  }
}

async function logSessionInvalid(reason: string, request: NextRequest, token?: string) {
  console.warn('[AUTH_SESSION_INVALID]', JSON.stringify({
    reason,
    path: request.nextUrl.pathname,
    method: request.method,
    hostname: request.nextUrl.hostname,
    tokenHash: token ? await sessionTokenFingerprint(token) : undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 200) || undefined,
    at: new Date().toISOString(),
  }))
}

function unauthorizedApiResponse() {
  return withNoStoreHeaders(NextResponse.json(
    { ok: false, code: 'UNAUTHENTICATED', message: '请先登录' },
    { status: 401 },
  ))
}

function authVerificationUnavailableResponse(request: NextRequest) {
  console.error('[AUTH_SESSION_CHECK_FAILED]', JSON.stringify({
    reason: 'VERIFICATION_ERROR',
    path: request.nextUrl.pathname,
    method: request.method,
    hostname: request.nextUrl.hostname,
    requestId: request.headers.get('x-request-id')?.slice(0, 120) || undefined,
    at: new Date().toISOString(),
  }))
  if (isApiPath(request.nextUrl.pathname)) {
    return withNoStoreHeaders(NextResponse.json(
      { ok: false, code: 'AUTH_SESSION_CHECK_FAILED', message: '登录服务暂时不可用，请稍后重试' },
      { status: 503 },
    ))
  }
  return withNoStoreHeaders(new NextResponse('登录服务暂时不可用，请稍后重试', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  }))
}

function forbiddenAdminApiResponse() {
  return withNoStoreHeaders(NextResponse.json(
    { ok: false, code: 'FORBIDDEN', message: '无权限访问' },
    { status: 403 },
  ))
}

function loginRedirect(request: NextRequest, reason: NonNullable<SessionVerification['reason']> = 'NO_SESSION') {
  const nextPath = safeInternalPath(`${request.nextUrl.pathname}${request.nextUrl.search}` || '/', '/')
  const target = `/login?next=${encodeURIComponent(nextPath)}`
  const resolvedOrigin = getPublicOrigin(request)
  const location = buildPublicAbsoluteUrl(target, request)
  console.warn('[auth.redirect]', {
    event: 'AUTH_REDIRECT_LOGIN',
    source: 'middleware',
    path: request.nextUrl.pathname,
    pathname: request.nextUrl.pathname,
    reason,
    hasSessionCookie: request.cookies.getAll(authCookieName).length > 0,
    tokenStatus: reason,
    userId: undefined,
    requestId: request.headers.get('x-request-id')?.slice(0, 120) || undefined,
    host: request.headers.get('host') || '',
    xfHost: request.headers.get('x-forwarded-host') || '',
    xfProto: request.headers.get('x-forwarded-proto') || '',
    resolvedOrigin,
    redirectTarget: target,
  })
  return withNoStoreHeaders(NextResponse.redirect(location))
}

function adminNoAccessRedirect(request: NextRequest) {
  const fromPath = safeInternalPath(`${request.nextUrl.pathname}${request.nextUrl.search}` || '/admin', '/admin')
  const target = `/admin/no-access?from=${encodeURIComponent(fromPath)}`
  return withNoStoreHeaders(NextResponse.redirect(buildPublicAbsoluteUrl(target, request)))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase()
  const hostHeader = request.headers.get('host')?.split(',')[0]?.trim().toLowerCase()
  const requestHost = normalizeHost(forwardedHost || hostHeader || request.nextUrl.hostname)
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const isSecure = forwardedProto === 'https' || request.nextUrl.protocol === 'https:'
  const isLocalHost = isLocalHostname(requestHost)

  // 强制 HTTPS：非 localhost 的明文 http 请求一律 308 升级到 https，保留原始 host
  // （ecfc.fans 升 ecfc.fans，www.ecfc.fans 升 www.ecfc.fans，不强制 www→apex）。
  // 否则 Secure 会话 Cookie 无法被浏览器存储，移动端 / 微信「关闭重开」后会丢失登录态。
  // （依赖反代转发的 x-forwarded-proto 判断真实协议，避免回源为 http 时误判。）
  if (!isSecure && !isLocalHost) {
    const securePath = `${request.nextUrl.pathname}${request.nextUrl.search}` || '/'
    return withNoStoreHeaders(NextResponse.redirect(buildPublicAbsoluteUrl(securePath, request), 308))
  }

  // SameSite cookies are a useful baseline, but they do not cover every
  // browser/navigation edge case. Reject an explicitly cross-site browser
  // write while keeping Origin-less native clients and CLI integrations valid.
  const isMobileAuthPath = pathname.startsWith('/api/mobile/auth/')
  if (isApiPath(pathname) && isStateChangingMethod(request.method) && !isMobileAuthPath && isCrossSiteRequest(request)) {
    const response = NextResponse.json(
      { ok: false, code: 'CSRF_BLOCKED', message: '请求来源校验失败，请刷新页面后重试' },
      { status: 403, headers: { Vary: 'Origin, Referer, Sec-Fetch-Site' } },
    )
    return withNoStoreHeaders(response)
  }

  if (guessSongMediaGatewayPaths.has(pathname)) {
    return NextResponse.next()
  }

  // These business handlers resolve Bearer auth at route level. Let the native
  // app reach the allowlisted paths without a browser Cookie; the route guards
  // still enforce the mobile credential and the global CSRF check remains active.
  if (isMobileBearerBusinessRequest(request, pathname)) {
    return withNoStoreHeaders(NextResponse.next())
  }

  if (isPublicPath(pathname)) {
    const response = NextResponse.next()
    return isImmutablePublicPath(pathname)
      ? withImmutableCacheHeaders(response)
      : withNoStoreHeaders(response)
  }

  const verification = await verifyRequestSession(request)
  if (verification.internalError) return authVerificationUnavailableResponse(request)
  const session = verification.session
  if (!session) return isApiPath(pathname) ? unauthorizedApiResponse() : loginRedirect(request, verification.reason || 'TOKEN_INVALID')

  // 滚动续期：JWT 剩余有效期不足阈值时重签同 claims 的 cookie（沿用 30 天有效期）。
  // 持续活跃用户不会因固定过期在长时间游戏中突然掉登录。
  if (session.needsRollingRenew) {
    const cookie = await renewSessionCookie(request, session.token)
    if (cookie) {
      const response = withNoStoreHeaders(NextResponse.next())
      response.cookies.set(authCookieName, cookie.token, cookie.options)
      return response
    }
  }

  // 后台细粒度权限由服务端 requireAdmin / requireAdminPage 查询权限表；
  // 中间件只负责确认登录，避免把拥有权限但 role 尚未同步为 ADMIN 的用户提前拦截。
  return withNoStoreHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icons/|robots.txt|manifest.webmanifest).*)'],
}
