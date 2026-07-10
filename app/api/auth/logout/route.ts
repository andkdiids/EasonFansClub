import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authCookieName } from '@/lib/auth'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  cookieStore.delete(authCookieName)

  const accept = request.headers.get('accept') || ''
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
  }

  return NextResponse.json({ ok: true })
}
