import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { authCookieName, createSessionToken, getSessionCookieOptions } from '@/lib/auth'
import { findCompleteActiveUserByIdentifier } from '@/lib/users'
import { normalizeText } from '@/lib/validators'

const unregisteredMessage = '该账户未注册，请先注册'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const identifier = normalizeText(body?.identifier)
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!identifier || !password) {
      return NextResponse.json(
        { message: '请填写账号和密码', errors: { form: '请填写账号和密码' } },
        { status: 400 },
      )
    }

    const user = await findCompleteActiveUserByIdentifier(identifier)
    if (!user) {
      return NextResponse.json(
        { message: unregisteredMessage, errors: { identifier: unregisteredMessage } },
        { status: 401 },
      )
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash)
    if (!isValidPassword) {
      return NextResponse.json(
        { message: '账号或密码不正确', errors: { password: '账号或密码不正确' } },
        { status: 401 },
      )
    }

    const sessionUser = {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    }
    const token = await createSessionToken(sessionUser)
    const response = NextResponse.json(
      { user: sessionUser },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
    response.cookies.set(authCookieName, token, getSessionCookieOptions(request))

    return response
  } catch (error) {
    console.error(error)
    return NextResponse.json(
      { message: '登录失败，请稍后再试', errors: { form: '登录失败，请稍后再试' } },
      { status: 500 },
    )
  }
}
