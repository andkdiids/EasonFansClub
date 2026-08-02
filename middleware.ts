import { NextResponse, type NextRequest } from 'next/server'

const authCookieName = 'eason_fans_session'
const canonicalHost = 'ecfc.fans'
const noStoreValue = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'

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

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim().toLowerCase()
  const requestHost = normalizeHost(forwardedHost || request.nextUrl.hostname)

  if (requestHost === 'www.ecfc.fans') {
    const canonicalUrl = request.nextUrl.clone()
    canonicalUrl.protocol = 'https:'
    canonicalUrl.hostname = canonicalHost
    canonicalUrl.port = ''
    return withNoStoreHeaders(NextResponse.redirect(canonicalUrl, 308))
  }

  if (
    (pathname === '/' || pathname === '/welcome' || pathname === '/community') &&
    !request.cookies.has(authCookieName)
  ) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', pathname)
    return withNoStoreHeaders(NextResponse.redirect(loginUrl))
  }

  return withNoStoreHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
