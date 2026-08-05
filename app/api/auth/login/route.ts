import { NextResponse } from 'next/server'
import { authCookieName, createSessionToken, getSessionCookieOptions } from '@/lib/auth'
import { DbTimeoutError, withDbTimeout } from '@/lib/db-timeout'
import { hashPassword, verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { findCompleteUserByLoginIdentifier } from '@/lib/users'
import { normalizeText } from '@/lib/validators'
import { ensureSecurityQuestionNotification } from '@/lib/account-security'
import { ensureBirthdayBadge, sendBirthdayGreeting } from '@/lib/birthday'

const loginUserQueryTimeoutMs = 4500
const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function isDatabaseTimeout(error: unknown) {
  if (error instanceof DbTimeoutError) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('timeout') || message.includes('timed out')
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
   const identifierType =
  body?.identifierType === 'email'
    ? 'email'
    : 'phone'

const identifier = identifierType === 'email'
  ? normalizeText(body?.identifier).toLowerCase()
  : normalizeText(body?.identifier)

const password = typeof body?.password === 'string' ? body.password : ''

    if (!identifier || !password) {
      return NextResponse.json(
        { message: '请填写账号和密码', errors: { form: '请填写账号和密码' } },
        { status: 400, headers: noStoreHeaders },
      )
    }

    const user = await withDbTimeout(
      'login.user-query',
      findCompleteUserByLoginIdentifier(identifierType, identifier),
      loginUserQueryTimeoutMs,
    )

    if (!user) {
      const message =
  identifierType === 'email'
    ? '邮箱未注册'
    : '手机号未注册'
      return NextResponse.json(
        { message, errors: { identifier: message } },
        { status: 401, headers: noStoreHeaders },
      )
    }

    if (user.status !== 'ACTIVE') {
      return NextResponse.json(
        { message: '账号已禁用', errors: { form: '账号已禁用' } },
        { status: 403, headers: noStoreHeaders },
      )
    }

    if (identifierType === 'email' && !user.emailVerifiedAt) {
      return NextResponse.json(
        { message: '邮箱尚未验证，请先查收邮件完成验证', errors: { identifier: '邮箱尚未验证' } },
        { status: 403, headers: noStoreHeaders },
      )
    }

    const passwordResult = await verifyPassword(password, user.passwordHash)
    if (!passwordResult.valid) {
      return NextResponse.json(
        { message: '密码错误', errors: { password: '密码错误' } },
        { status: 401, headers: noStoreHeaders },
      )
    }

    const sessionUser = {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    }

    if (passwordResult.needsRehash) {
      await withDbTimeout(
        'login.password-migration',
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) },
        }),
        3000,
      )
    }

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

    const token = await createSessionToken(sessionUser)
    const response = NextResponse.json({ user: sessionUser }, { headers: noStoreHeaders })
    response.cookies.set(authCookieName, token, getSessionCookieOptions(request))
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
