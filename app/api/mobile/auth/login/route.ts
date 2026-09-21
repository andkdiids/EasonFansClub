import { NextResponse } from 'next/server'
import {
  authenticateLoginCredentials,
  consumeLoginRateLimit,
  isDatabaseTimeout,
  parseLoginCredentials,
  recordLoginSecurityEvent,
  rehashPasswordIfNeeded,
} from '@/lib/auth-credentials'
import {
  getMobileUserById,
  isMobileAuthConfigurationError,
  issueMobileSession,
} from '@/lib/mobile-auth'
import { rateLimitResponse } from '@/lib/security'
import { requireMobileBetaAccess } from '@/lib/mobile-beta'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function invalidCredentialsResponse() {
  return NextResponse.json(
    { ok: false, code: 'INVALID_CREDENTIALS', message: '账号或密码错误' },
    { status: 401, headers: noStoreHeaders },
  )
}

function serviceUnavailableResponse() {
  return NextResponse.json(
    { ok: false, code: 'MOBILE_AUTH_SERVICE_UNAVAILABLE', message: '移动端登录服务暂时不可用，请稍后再试' },
    { status: 503, headers: noStoreHeaders },
  )
}

export async function POST(request: Request) {
  try {
    const betaResponse = await requireMobileBetaAccess(request)
    if (betaResponse) return betaResponse
    const body = await request.json().catch(() => null)
    const parsed = parseLoginCredentials(body)
    if (!parsed.ok) {
      return NextResponse.json(
        { ok: false, code: parsed.reason, message: parsed.message, errors: parsed.errors },
        { status: 400, headers: noStoreHeaders },
      )
    }

    const loginLimit = await consumeLoginRateLimit(request, parsed.credentials)
    if (loginLimit.limited) return rateLimitResponse(loginLimit, '登录尝试过于频繁，请稍后再试')

    const authentication = await authenticateLoginCredentials(parsed.credentials, {
      onFailure: (userId, reason) => recordLoginSecurityEvent(userId, request, reason),
    })
    if (!authentication.ok) return invalidCredentialsResponse()

    await rehashPasswordIfNeeded(authentication.user.id, parsed.credentials.password, authentication.passwordResult)
    const user = await getMobileUserById(authentication.user.id)
    if (!user) return invalidCredentialsResponse()

    const tokens = await issueMobileSession(user)
    return NextResponse.json(tokens, { headers: noStoreHeaders })
  } catch (error) {
    if (isMobileAuthConfigurationError(error) || isDatabaseTimeout(error)) return serviceUnavailableResponse()
    console.error('[mobile.auth.login]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
    return NextResponse.json(
      { ok: false, code: 'MOBILE_AUTH_ERROR', message: '登录失败，请稍后再试' },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
