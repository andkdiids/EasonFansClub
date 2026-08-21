import { NextResponse } from 'next/server'
import { getCurrentUser, isAuthServiceUnavailableError } from '@/lib/auth'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

/**
 * Resolve the current session from the HttpOnly cookie. This endpoint is used
 * by the client bootstrap after a browser/webview is reopened; it never trusts
 * React memory or a client-provided user id.
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    // This endpoint is a session-authority probe, not a profile/admin data
    // endpoint. Keep the response to the fields needed by the client shell.
    const session = user
      ? { id: user.id, uid: user.uid, nickname: user.nickname, avatarUrl: user.avatarUrl }
      : null
    return NextResponse.json({ user: session }, { headers: noStoreHeaders })
  } catch (error) {
    if (isAuthServiceUnavailableError(error)) {
      return NextResponse.json({ user: null, code: 'AUTH_SERVICE_UNAVAILABLE' }, { status: 503, headers: noStoreHeaders })
    }
    console.error('[auth.me]', error)
    return NextResponse.json({ user: null, code: 'AUTH_CHECK_FAILED' }, { status: 500, headers: noStoreHeaders })
  }
}
