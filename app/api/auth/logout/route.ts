import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { authCookieName } from '@/lib/auth'

const noStoreHeaders = {
  'Cache-Control': 'no-store, max-age=0',
}

export async function POST(request: Request) {
  const cookieStore = await cookies()
  cookieStore.delete(authCookieName)

  const accept = request.headers.get('accept') || ''
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL('/login', request.url), { status: 303, headers: noStoreHeaders })
  }

  return NextResponse.json({ ok: true }, { headers: noStoreHeaders })
}
