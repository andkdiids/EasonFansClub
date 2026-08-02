import { NextResponse } from 'next/server'
import { authCookieName, getSessionCookieDeletionOptions } from '@/lib/auth'

const noStoreHeaders = {
  'Cache-Control': 'no-store, max-age=0',
}

export async function POST(request: Request) {
  const accept = request.headers.get('accept') || ''
  if (accept.includes('text/html')) {
    const response = NextResponse.redirect(new URL('/login', request.url), { status: 303, headers: noStoreHeaders })
    response.cookies.set(authCookieName, '', getSessionCookieDeletionOptions(request))
    return response
  }

  const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders })
  response.cookies.set(authCookieName, '', getSessionCookieDeletionOptions(request))
  return response
}
