import { NextResponse } from 'next/server'
import { authCookieName, createSessionToken, getSessionCookieOptions } from '@/lib/auth'
import { DbTimeoutError, withDbTimeout } from '@/lib/db-timeout'
import { hashPassword, verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { findCompleteActiveUserByIdentifier } from '@/lib/users'
import { normalizeText } from '@/lib/validators'

const unregisteredMessage = '该账户未注册，请先注册'

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
      message: 'Login service is temporarily unavailable. Please try again later.',
      errors: { form: 'Login service is temporarily unavailable. Please try again later.' },
    },
    { status: 503, headers: noStoreHeaders },
  )
}

export async function POST(request: Request) {
  console.log('login:start')
  try {
    const body = await request.json().catch(() => null)
    console.log('login:body-parsed')
    const identifier = normalizeText(body?.identifier)
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!identifier || !password) {
      return NextResponse.json(
        { message: '请填写账号和密码', errors: { form: '请填写账号和密码' } },
        { status: 400, headers: noStoreHeaders },
      )
    }

    console.log('login:user-query:start')
    const user = await withDbTimeout(
      'login.user-query',
      findCompleteActiveUserByIdentifier(identifier),
      loginUserQueryTimeoutMs,
    )
    console.log('login:user-query:done')
    if (!user) {
      return NextResponse.json(
        { message: unregisteredMessage, errors: { identifier: unregisteredMessage } },
        { status: 401, headers: noStoreHeaders },
      )
    }

    console.log('login:password-verify:start')
    const passwordResult = await verifyPassword(password, user.passwordHash)
    console.log('login:password-verify:done')
    if (!passwordResult.valid) {
      return NextResponse.json(
        { message: '账号或密码不正确', errors: { password: '账号或密码不正确' } },
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
      console.log('login:password-migration:start')
      await withDbTimeout(
        'login.password-migration',
        prisma.user.update({
          where: { id: user.id },
          data: { passwordHash: await hashPassword(password) },
        }),
        3000,
      )
      console.log('login:password-migration:done')
    }

    const token = await createSessionToken(sessionUser)
    console.log('login:token:done')
    const response = NextResponse.json(
      { user: sessionUser },
      { headers: noStoreHeaders },
    )
    response.cookies.set(authCookieName, token, getSessionCookieOptions(request))
    console.log('login:response-ready')

    return response
  } catch (error) {
    if (isDatabaseTimeout(error)) {
      console.error('login:user-query:timeout', error)
      return databaseUnavailableResponse()
    }

    console.error(error)
    return NextResponse.json(
      { message: '登录失败，请稍后再试', errors: { form: '登录失败，请稍后再试' } },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
