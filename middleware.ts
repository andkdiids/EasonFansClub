import { jwtVerify } from 'jose'
import { NextResponse, type NextRequest } from 'next/server'

const authCookieName = 'eason_fans_session'
const noStoreValue = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
const jwtSecret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-before-production')

const publicExactPaths = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/user-agreement',
  '/favicon.ico',
  '/robots.txt',
  '/manifest.webmanifest',
])

const publicPathPrefixes = [
  '/api/auth/',
  '/_next/',
  '/easmusic/',
  '/images/',
  '/fonts/',
  '/uploads/',
]

type VerifiedSession = {
  id: string
  role: string | null
}

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set('Cache-Control', noStoreValue)
  response.headers.set('CDN-Cache-Control', 'no-store')
  response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
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

function isApiPath(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isAdminPagePath(pathname: string) {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}

function isAdminApiPath(pathname: string) {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/')
}

function isAdminRole(role: string | null) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

async function verifyRequestSession(request: NextRequest): Promise<VerifiedSession | null> {
  const token = request.cookies.get(authCookieName)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
    if (typeof payload.id !== 'string' || !payload.id.trim()) return null
    return {
      id: payload.id,
      role: typeof payload.role === 'string' ? payload.role : null,
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
  const loginUrl = new URL('/login', request.url)
  const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}` || '/'
  loginUrl.searchParams.set('next', nextPath)
  return withNoStoreHeaders(NextResponse.redirect(loginUrl))
}

function adminNoAccessRedirect(request: NextRequest) {
  const noAccessUrl = new URL('/admin/no-access', request.url)
  const fromPath = `${request.nextUrl.pathname}${request.nextUrl.search}` || '/admin'
  noAccessUrl.searchParams.set('from', fromPath)
  return withNoStoreHeaders(NextResponse.redirect(noAccessUrl))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase()
  const requestHost = normalizeHost(forwardedHost || request.nextUrl.hostname)
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  const isSecure = forwardedProto === 'https' || request.nextUrl.protocol === 'https:'
  const isLocalHost = requestHost === 'localhost' || requestHost === '127.0.0.1' || requestHost.startsWith('127.0.0.1') || requestHost === '[::1]'

  // 强制 HTTPS：非 localhost 的明文 http 请求一律 308 升级到 https，保留原始 host
  // （ecfc.fans 升 ecfc.fans，www.ecfc.fans 升 www.ecfc.fans，不强制 www→apex）。
  // 否则 Secure 会话 Cookie 无法被浏览器存储，移动端 / 微信「关闭重开」后会丢失登录态。
  // （依赖反代转发的 x-forwarded-proto 判断真实协议，避免回源为 http 时误判。）
  if (!isSecure && !isLocalHost) {
    const secureUrl = request.nextUrl.clone()
    secureUrl.protocol = 'https:'
    secureUrl.hostname = requestHost
    secureUrl.port = ''
    return withNoStoreHeaders(NextResponse.redirect(secureUrl, 308))
  }

  if (isPublicPath(pathname)) return withNoStoreHeaders(NextResponse.next())

  const session = await verifyRequestSession(request)
  if (!session) return isApiPath(pathname) ? unauthorizedApiResponse() : loginRedirect(request)

  if (isAdminApiPath(pathname) && !isAdminRole(session.role)) {
    return forbiddenAdminApiResponse()
  }

  if (isAdminPagePath(pathname) && pathname !== '/admin/no-access' && !isAdminRole(session.role)) {
    return adminNoAccessRedirect(request)
  }

  return withNoStoreHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest).*)'],
}
