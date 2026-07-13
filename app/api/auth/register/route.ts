import { NextResponse } from 'next/server'
import { syncUserAchievements } from '@/lib/achievements'
import {
  canSendEmailVerification,
  createVerificationForUser,
  isValidEmail,
  normalizeEmail,
  sendVerificationEmail,
} from '@/lib/email-verification'
import { hashPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { getClientIp, rateLimit } from '@/lib/security'
import { verifyTurnstileToken } from '@/lib/turnstile'
import { findActiveConflict } from '@/lib/users'
import { MAX_UID } from '@/lib/uid'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function unicodeLength(value: string) {
  return Array.from(value).length
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const nickname = normalizeText(body?.nickname || body?.username)
    const username = nickname
    const email = normalizeEmail(body?.email)
    const password = normalizeText(body?.password)
    const confirmPassword = normalizeText(body?.confirmPassword)
    const acceptedAgreement = Boolean(body?.acceptedAgreement)

    const limited = await rateLimit(`ip:${getClientIp(request)}`, 'register', 3, 60 * 60)
    if (limited) return limited

    const errors: Record<string, string> = {}
    if (!nickname) errors.nickname = '请填写用户名/昵称'
    if (nickname && (unicodeLength(nickname) < 2 || unicodeLength(nickname) > 16)) {
      errors.nickname = '用户名长度需要 2-16 个字符'
    }
    if (!email) errors.email = '请填写邮箱'
    if (email && !isValidEmail(email)) errors.email = '请输入有效邮箱'
    if (!password || password.length < 8) errors.password = '密码至少需要 8 位'
    if (confirmPassword !== password) errors.confirmPassword = '两次输入的密码不一致'
    if (!acceptedAgreement) errors.acceptedAgreement = '请先勾选用户协议'

    const turnstile = await verifyTurnstileToken(body?.turnstileToken, request)
    if (!turnstile.success) errors.turnstileToken = turnstile.message || '人机验证失败'

    if (Object.keys(errors).length) {
      return NextResponse.json({ message: '请检查注册信息', errors }, { status: 400, headers: noStoreHeaders })
    }

    const duplicate = await findActiveConflict({ email, username })
    if (duplicate) {
      return NextResponse.json(
        {
          message: '账号信息已存在',
          errors: {
            ...(duplicate.email === email ? { email: '邮箱已被注册' } : {}),
            ...(duplicate.username === username ? { nickname: '该昵称已被使用' } : {}),
          },
        },
        { status: 409, headers: noStoreHeaders },
      )
    }

    if (!(await canSendEmailVerification(email))) {
      return NextResponse.json(
        { message: '验证邮件发送过于频繁，请 10 分钟后再试', errors: { email: '验证邮件发送过于频繁，请 10 分钟后再试' } },
        { status: 429, headers: noStoreHeaders },
      )
    }

    const passwordHash = await hashPassword(password)
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
          email,
          emailVerifiedAt: null,
          phone: null,
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

    const verification = await createVerificationForUser(user.id, email)
    const emailResult = await sendVerificationEmail(email, verification.verificationUrl)

    await syncUserAchievements(user.id, ['REGISTER']).catch((achievementError) => {
      console.error('[achievements:register]', achievementError)
    })

    return NextResponse.json(
      {
        user,
        message: '注册成功，请先查收邮件完成邮箱验证',
        emailSent: emailResult.sent,
        devVerificationUrl: process.env.NODE_ENV === 'production' ? undefined : verification.verificationUrl,
      },
      { status: 201, headers: noStoreHeaders },
    )
  } catch (error) {
    console.error(error)
    if (error instanceof Error && error.message === 'UID_LIMIT_REACHED') {
      return NextResponse.json(
        { message: '成员 UID 已达到 5 位上限', errors: { form: '成员 UID 已达到 5 位上限' } },
        { status: 409, headers: noStoreHeaders },
      )
    }

    return NextResponse.json(
      { message: '注册失败，请稍后再试', errors: { form: '注册失败，请稍后再试' } },
      { status: 500, headers: noStoreHeaders },
    )
  }
}
