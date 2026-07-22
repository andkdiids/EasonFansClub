import { NextResponse, type NextRequest } from 'next/server'

const authCookieName = 'eason_fans_session'
const noStoreValue = 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set('Cache-Control', noStoreValue)
  response.headers.set('CDN-Cache-Control', 'no-store')
  response.headers.set('Cloudflare-CDN-Cache-Control', 'no-store')
  return response
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if ((pathname === '/' || pathname === '/welcome' || pathname === '/community') && !request.cookies.has(authCookieName)) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('redirect', '/welcome')
    return withNoStoreHeaders(NextResponse.redirect(loginUrl))
  }

  return withNoStoreHeaders(NextResponse.next())
}

export const config = {
  matcher: ['/', '/welcome', '/community', '/login', '/register', '/api/auth/:path*'],
}
