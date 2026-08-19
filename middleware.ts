import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
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
  } catch {
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

async function verifyRequestSession(request: NextRequest): Promise<VerifiedSession | null> {
  const token = request.cookies.get(authCookieName)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
    if (typeof payload.id !== 'string' || !payload.id.trim()) return null
    const exp = typeof payload.exp === 'number' ? payload.exp : 0
    const remainingMs = exp * 1000 - Date.now()
    return {
      id: payload.id,
      role: typeof payload.role === 'string' ? payload.role : null,
      // 剩余有效期不足阈值且尚未过期 → 需要滚动续期
      needsRollingRenew: remainingMs > 0 && remainingMs < ROLLING_RENEW_BEFORE_MS,
    }
  } catch {
    return null
  }
}

function unauthorizedApiResponse() {
  return withNoStoreHeaders(NextResponse.json(
    { ok: false, code: 'UNAUTHORIZED', message: '请先登录' },
    { status: 401 },
  ))
}

function forbiddenAdminApiResponse() {
  return withNoStoreHeaders(NextResponse.json(
    { ok: false, code: 'FORBIDDEN', message: '无权限访问' },
    { status: 403 },
  ))
}

function loginRedirect(request: NextRequest) {
  const nextPath = safeInternalPath(`${request.nextUrl.pathname}${request.nextUrl.search}` || '/', '/')
  const target = `/login?next=${encodeURIComponent(nextPath)}`
  const resolvedOrigin = getPublicOrigin(request)
  const location = buildPublicAbsoluteUrl(target, request)
  console.warn('[auth.redirect]', {
    path: request.nextUrl.pathname,
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

  const session = await verifyRequestSession(request)
  if (!session) return isApiPath(pathname) ? unauthorizedApiResponse() : loginRedirect(request)

  // 滚动续期：JWT 剩余有效期不足阈值时重签同 claims 的 cookie（沿用 30 天有效期）。
  // 持续活跃用户不会因固定过期在长时间游戏中突然掉登录。
  if (session.needsRollingRenew) {
    const cookie = await renewSessionCookie(request, request.cookies.get(authCookieName)?.value || '')
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
