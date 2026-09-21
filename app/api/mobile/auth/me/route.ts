import { NextResponse } from 'next/server'
import { isDatabaseTimeout } from '@/lib/auth-credentials'
import { isMobileAuthConfigurationError, resolveMobileAccess } from '@/lib/mobile-auth'
import { requireMobileBetaAccess } from '@/lib/mobile-beta'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function unauthorizedResponse() {
  return NextResponse.json(
    { ok: false, code: 'UNAUTHENTICATED', message: '请先登录' },
    { status: 401, headers: noStoreHeaders },
  )
}

export async function GET(request: Request) {
  try {
    const betaResponse = await requireMobileBetaAccess(request)
    if (betaResponse) return betaResponse
    const auth = await resolveMobileAccess(request)
    if (!auth) return unauthorizedResponse()
    return NextResponse.json({ user: auth.user }, { headers: noStoreHeaders })
  } catch (error) {
    if (isMobileAuthConfigurationError(error) || isDatabaseTimeout(error)) {
      return NextResponse.json(
        { ok: false, code: 'MOBILE_AUTH_SERVICE_UNAVAILABLE', message: '认证服务暂时不可用，请稍后再试' },
        { status: 503, headers: noStoreHeaders },
      )
    }
    console.error('[mobile.auth.me]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json(
      { ok: false, code: 'MOBILE_AUTH_ERROR', message: '认证服务暂时不可用，请稍后再试' },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
