import { SignJWT, jwtVerify, errors as joseErrors, type JWTPayload } from 'jose'
import { NextResponse, type NextRequest } from 'next/server'
import { authCookieName, getSessionCookieOptions, SESSION_MAX_AGE_SECONDS } from '@/lib/auth-cookie'
import { buildPublicAbsoluteUrl, getPublicOrigin, isLocalHostname, safeInternalPath } from '@/lib/url-safety'
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
  '/robots.txt',
  '/manifest.webmanifest',
  '/d89ed4255676640e037130589550e237.txt',
  '/clinic',
  '/api/clinic',
])

const publicPathPrefixes = [
  '/api/auth/',
  '/_next/',
  '/easmusic/',
  '/images/',
  '/fonts/',
  '/uploads/',
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
  return publicPathPrefixes.some((prefix) => pathname.startsWith(prefix))
}

function isImmutablePublicPath(pathname: string) {
  return immutablePublicPathPrefixes.some((prefix) => pathname.startsWith(prefix))
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
      logSessionInvalid('PAYLOAD_INVALID', request, token)
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
      logSessionInvalid('SESSION_EXPIRED', request, token)
      return { session: null, internalError: false, reason: 'TOKEN_EXPIRED' }
    }
    if (error instanceof joseErrors.JOSEError) {
      logSessionInvalid('INVALID_SIGNATURE', request, token)
      return { session: null, internalError: false, reason: 'TOKEN_INVALID' }
    }
    logSessionInvalid('VERIFICATION_ERROR', request, token)
    return { session: null, internalError: true, reason: 'VERIFY_FAILED' }
  }
}

function sessionTokenFingerprint(token: string) {
  if (token.length <= 12) return '***'
  return `${token.slice(0, 4)}...${token.slice(-8)}`
}

function logSessionInvalid(reason: string, request: NextRequest, token?: string) {
  console.warn('[AUTH_SESSION_INVALID]', JSON.stringify({
    reason,
    path: request.nextUrl.pathname,
    method: request.method,
    hostname: request.nextUrl.hostname,
    tokenHash: token ? sessionTokenFingerprint(token) : undefined,
    userAgent: request.headers.get('user-agent')?.slice(0, 200) || undefined,
    at: new Date().toISOString(),
  }))
}

function unauthorizedApiResponse() {
  return withNoStoreHeaders(NextResponse.json(
    { ok: false, code: 'UNAUTHORIZED', message: '请先登录' },
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

  if (guessSongMediaGatewayPaths.has(pathname)) {
    return NextResponse.next()
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
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest).*)'],
}
