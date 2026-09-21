import { NextResponse } from 'next/server'
import { isDatabaseTimeout } from '@/lib/auth-credentials'
import {
  getBearerToken,
  isMobileAuthConfigurationError,
  revokeMobileSession,
  verifyMobileAccessToken,
} from '@/lib/mobile-auth'
import { requireMobileBetaAccess } from '@/lib/mobile-beta'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  try {
    const betaResponse = await requireMobileBetaAccess(request)
    if (betaResponse) return betaResponse
    const body = await request.json().catch(() => null)
    const refreshToken = body && typeof body === 'object' && typeof (body as Record<string, unknown>).refreshToken === 'string'
      ? (body as Record<string, string>).refreshToken
      : null
    const accessToken = getBearerToken(request.headers.get('authorization'))
    const claims = accessToken ? await verifyMobileAccessToken(accessToken) : null

    await revokeMobileSession({ sessionId: claims?.sessionId, refreshToken })
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders })
  } catch (error) {
    if (isMobileAuthConfigurationError(error) || isDatabaseTimeout(error)) {
      return NextResponse.json(
        { ok: false, code: 'MOBILE_AUTH_SERVICE_UNAVAILABLE', message: '认证服务暂时不可用，请稍后再试' },
        { status: 503, headers: noStoreHeaders },
      )
    }
    console.error('[mobile.auth.logout]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json(
      { ok: false, code: 'MOBILE_AUTH_ERROR', message: '退出登录服务暂时不可用，请稍后再试' },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
