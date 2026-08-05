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
    return NextResponse.json({ user }, { headers: noStoreHeaders })
  } catch (error) {
    if (isAuthServiceUnavailableError(error)) {
      return NextResponse.json({ user: null, code: 'AUTH_SERVICE_UNAVAILABLE' }, { status: 503, headers: noStoreHeaders })
    }
    console.error('[auth.me]', error)
    return NextResponse.json({ user: null, code: 'AUTH_CHECK_FAILED' }, { status: 500, headers: noStoreHeaders })
  }
}
