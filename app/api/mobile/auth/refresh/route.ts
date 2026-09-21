import { NextResponse } from 'next/server'
import { isDatabaseTimeout } from '@/lib/auth-credentials'
import {
  isInvalidMobileRefreshTokenError,
  isMobileAuthConfigurationError,
  rotateMobileRefreshToken,
} from '@/lib/mobile-auth'
import { requireMobileBetaAccess } from '@/lib/mobile-beta'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function invalidRefreshResponse() {
  return NextResponse.json(
    { ok: false, code: 'INVALID_REFRESH_TOKEN', message: '登录状态已失效，请重新登录' },
    { status: 401, headers: noStoreHeaders },
  )
}

export async function POST(request: Request) {
  try {
    const betaResponse = await requireMobileBetaAccess(request)
    if (betaResponse) return betaResponse
    const body = await request.json().catch(() => null)
    const refreshToken = body && typeof body === 'object' && typeof (body as Record<string, unknown>).refreshToken === 'string'
      ? (body as Record<string, string>).refreshToken
      : ''
    if (!refreshToken.trim()) return invalidRefreshResponse()

    const tokens = await rotateMobileRefreshToken(refreshToken)
    return NextResponse.json(tokens, { headers: noStoreHeaders })
  } catch (error) {
    if (isInvalidMobileRefreshTokenError(error)) return invalidRefreshResponse()
    if (isMobileAuthConfigurationError(error) || isDatabaseTimeout(error)) {
      return NextResponse.json(
        { ok: false, code: 'MOBILE_AUTH_SERVICE_UNAVAILABLE', message: '认证服务暂时不可用，请稍后再试' },
        { status: 503, headers: noStoreHeaders },
      )
    }
    console.error('[mobile.auth.refresh]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json(
      { ok: false, code: 'MOBILE_AUTH_ERROR', message: '认证服务暂时不可用，请稍后再试' },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
