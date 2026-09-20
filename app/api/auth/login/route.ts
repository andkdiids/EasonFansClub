import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createSessionToken } from '@/lib/auth'
import { authCookieName, getSessionCookieOptions } from '@/lib/auth-cookie'
import { appendLegacyHostCookieDeletion } from '@/lib/auth-session-cookie'
import { authenticateLoginCredentials, consumeLoginRateLimit, isDatabaseTimeout, parseLoginCredentials, rehashPasswordIfNeeded } from '@/lib/auth-credentials'
import { prisma } from '@/lib/prisma'
import { ensureSecurityQuestionNotification } from '@/lib/account-security'
import { ensureBirthdayBadge, sendBirthdayGreeting } from '@/lib/birthday'
import { triggerBadgeEvaluation } from '@/lib/badge-rule-engine'
import { updateUserIpRegion } from '@/lib/ip-region'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicModerationUserName } from '@/lib/content-moderation'
import { getClientIp, rateLimitResponse } from '@/lib/security'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

async function recordLoginSecurityEvent(userId: string, request: Request, reason: string) {
  await prisma.accountSecurityLog.create({
    data: {
      userId,
      action: 'LOGIN_FAILED',
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 255) || null,
      metadata: { reason },
    },
  }).catch((error) => {
    console.warn('[auth.login.audit]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
  })
}

function databaseUnavailableResponse() {
  return NextResponse.json(
    {
      message: '登录服务暂时不可用，请稍后再试',
      errors: { form: '登录服务暂时不可用，请稍后再试' },
    },
    { status: 503, headers: noStoreHeaders },
  )
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const parsed = parseLoginCredentials(body)
    // parseLoginCredentials centralizes normalizePhoneNumber(rawIdentifier, requestedPhoneCountry)
    // and the shared service resolves findCompleteUserByLoginIdentifier(identifierType, identifier, requestedPhoneCountry).
    // It also retains the existing identifierType === 'email' && !user.emailVerifiedAt check.
    if (!parsed.ok) return NextResponse.json({ message: parsed.message, errors: parsed.errors }, { status: 400, headers: noStoreHeaders })
    const { credentials } = parsed

    const loginLimit = await consumeLoginRateLimit(request, credentials)
    if (loginLimit.limited) {
      return rateLimitResponse(loginLimit, '登录尝试过于频繁，请稍后再试')
    }

    const authentication = await authenticateLoginCredentials(credentials, {
      onFailure: (userId, reason) => recordLoginSecurityEvent(userId, request, reason),
    })

    if (!authentication.ok) {
      if (authentication.reason === 'ACCOUNT_NOT_FOUND') {
        const message = authentication.identifierType === 'email' ? '邮箱未注册' : '手机号未注册'
        return NextResponse.json(
          { code: 'INVALID_CREDENTIALS', message, errors: { identifier: message } },
          { status: 401, headers: noStoreHeaders },
        )
      }
      if (authentication.reason === 'ACCOUNT_DISABLED') {
        return NextResponse.json(
          { message: '账号已禁用', errors: { form: '账号已禁用' } },
          { status: 403, headers: noStoreHeaders },
        )
      }
      if (authentication.reason === 'EMAIL_UNVERIFIED') {
        return NextResponse.json(
          { message: '邮箱尚未验证，请先查收邮件完成验证', errors: { identifier: '邮箱尚未验证' } },
          { status: 403, headers: noStoreHeaders },
        )
      }
      return NextResponse.json(
        { code: 'INVALID_CREDENTIALS', message: '密码错误', errors: { password: '密码错误' } },
        { status: 401, headers: noStoreHeaders },
      )
    }

    const { user, passwordResult } = authentication

    void updateUserIpRegion(user.id, request)

    const sessionUser = {
      id: user.id,
      uid: user.uid,
      username: publicModerationUserName(user.username, [user.usernameModerationStatus]),
      nickname: getPublicUserDisplayName(user),
      role: user.role,
    }
    const responseUser = {
      id: sessionUser.id,
      uid: sessionUser.uid,
      nickname: sessionUser.nickname,
    }

    await rehashPasswordIfNeeded(user.id, credentials.password, passwordResult)

    await ensureSecurityQuestionNotification(user.id).catch((notificationError) => {
      console.error('[auth.login.security-question-notification]', notificationError)
    })

    // 登录成功后，若今天为该用户生日则自动授予「生日纪念」徽章并发送生日祝福（失败不影响登录）。
    await ensureBirthdayBadge(user.id).catch((badgeError) => {
      console.error('[auth.login.birthday-badge]', badgeError)
    })
    await sendBirthdayGreeting(user.id).catch((greetingError) => {
      console.error('[auth.login.birthday-greeting]', greetingError)
    })
    triggerBadgeEvaluation(user.id, 'USER_LOGIN', randomUUID())

    const token = await createSessionToken(sessionUser)
    const response = NextResponse.json({ user: responseUser }, { headers: noStoreHeaders })
    const cookieOptions = getSessionCookieOptions(request)
    response.cookies.set(authCookieName, token, cookieOptions)
    if (cookieOptions.domain) appendLegacyHostCookieDeletion(response, request)
    return response
  } catch (error) {
    if (isDatabaseTimeout(error)) return databaseUnavailableResponse()
    console.error('[auth.login]', error)
    return NextResponse.json(
      { message: '登录失败，请稍后再试', errors: { form: '登录失败，请稍后再试' } },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
