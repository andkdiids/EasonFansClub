import bcrypt from 'bcrypt'
import { NextResponse } from 'next/server'
import { syncUserAchievements } from '@/lib/achievements'
import { authCookieName, createSessionToken, getSessionCookieOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { findActiveConflict } from '@/lib/users'
import { MAX_UID } from '@/lib/uid'
import { normalizeText } from '@/lib/validators'

function unicodeLength(value: string) {
  return Array.from(value).length
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const nickname = normalizeText(body?.nickname || body?.username)
    const username = nickname
    const phone = normalizeText(body?.phone)
    const email = normalizeText(body?.email).toLowerCase()
    const password = normalizeText(body?.password)
    const acceptedAgreement = Boolean(body?.acceptedAgreement)

    const errors: Record<string, string> = {}
    if (!nickname) errors.nickname = '请填写用户名/昵称'
    if (nickname && (unicodeLength(nickname) < 2 || unicodeLength(nickname) > 16)) {
      errors.nickname = '用户名长度需要 2-16 个字符'
    }
    if (!phone) errors.phone = '请填写手机号'
    if (phone && !/^1\d{10}$/.test(phone)) errors.phone = '请输入 11 位中国大陆手机号'
    if (!password || password.length < 8) errors.password = '密码至少需要 8 位'
    if (!acceptedAgreement) errors.acceptedAgreement = '请先勾选用户协议'

    if (Object.keys(errors).length) {
      return NextResponse.json({ message: '请检查注册信息', errors }, { status: 400 })
    }

    const duplicate = await findActiveConflict({ phone, email: email || null, username })
    if (duplicate) {
      const duplicateErrors = {
        ...(duplicate.phone === phone ? { phone: '手机号已被绑定' } : {}),
        ...(email && duplicate.email === email ? { email: '邮箱已被绑定' } : {}),
        ...(duplicate.username === username ? { nickname: '该昵称已被使用' } : {}),
      }
      return NextResponse.json({ message: '账号信息已存在', errors: duplicateErrors }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.$transaction(async (tx) => {
      const latest = await tx.user.findFirst({
        orderBy: { uid: 'desc' },
        select: { uid: true },
      })
      if ((latest?.uid ?? -1) >= MAX_UID) {
        throw new Error('UID_LIMIT_REACHED')
      }

      const created = await tx.user.create({
        data: {
          username,
          nickname,
          phone,
          email: email || null,
          passwordHash,
          status: 'ACTIVE',
          isDeleted: false,
          profile: {
            create: {
              displayName: nickname,
            },
          },
        },
        select: {
          id: true,
          uid: true,
          username: true,
          nickname: true,
          role: true,
        },
      })

      await tx.pointLog.create({
        data: {
          userId: created.id,
          action: 'REGISTER',
          points: 0,
          before: 0,
          after: 0,
          reason: '注册账号',
        },
      })

      return created
    })

    const token = await createSessionToken(user)
    const response = NextResponse.json(
      { user },
      { status: 201, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    )
    response.cookies.set(authCookieName, token, getSessionCookieOptions(request))
    await syncUserAchievements(user.id, ['REGISTER']).catch((achievementError) => {
      console.error('[achievements:register]', achievementError)
    })

    return response
  } catch (error) {
    console.error(error)
    if (error instanceof Error && error.message === 'UID_LIMIT_REACHED') {
      return NextResponse.json(
        { message: '成员 UID 已达到 5 位上限', errors: { form: '成员 UID 已达到 5 位上限' } },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { message: '注册失败，请稍后再试', errors: { form: '注册失败，请稍后再试' } },
      { status: 500 },
    )
  }
}
