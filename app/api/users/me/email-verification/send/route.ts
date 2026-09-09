import { NextResponse } from 'next/server'
import {
  canSendProfileEmailVerificationCode,
  createProfileEmailVerificationCode,
  isValidEmail,
  normalizeEmail,
  sendProfileEmailVerificationCode,
} from '@/lib/email-verification'
import { isMailFailure, logMailFailure } from '@/lib/mail'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function errorResponse(message: string, code: string, status: number, field?: string) {
  return NextResponse.json({
    message,
    code,
    ...(field ? { field, errors: { [field]: message } } : {}),
  }, { status, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 10, windowSeconds: 60 * 60 },
    user: { limit: 5, windowSeconds: 60 * 60 },
    endpoint: '/api/users/me/email-verification/send',
  }, '验证码发送过于频繁，请稍后再试')
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  if (!email || !isValidEmail(email)) {
    return errorResponse('请输入正确的邮箱地址', 'INVALID_EMAIL', 400, 'email')
  }

  const current = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: { email: true, emailVerifiedAt: true },
  })
  if (!current) return errorResponse('账号不存在', 'USER_NOT_FOUND', 404)
  if (current.email === email && current.emailVerifiedAt) {
    return NextResponse.json({ message: '该邮箱已绑定并验证', code: 'EMAIL_ALREADY_VERIFIED' }, { headers: noStoreHeaders })
  }

  const existing = await prisma.user.findFirst({
    where: { email, isDeleted: false, status: 'ACTIVE', NOT: { id: guard.user.id } },
    select: { id: true },
  })
  if (existing) return errorResponse('该邮箱已被其他账号使用', 'EMAIL_TAKEN', 409, 'email')

  if (!(await canSendProfileEmailVerificationCode(guard.user.id, email))) {
    return NextResponse.json({
      message: '验证码发送过于频繁，请 60 秒后再试',
      code: 'EMAIL_CODE_RESEND_TOO_SOON',
    }, { status: 429, headers: { ...noStoreHeaders, 'Retry-After': '60' } })
  }

  const verification = await createProfileEmailVerificationCode(guard.user.id, email)
  try {
    const sent = await sendProfileEmailVerificationCode(email, verification.code)
    if (!sent.sent) {
      await prisma.emailVerification.updateMany({
        where: { userId: guard.user.id, email, usedAt: null },
        data: { usedAt: new Date() },
      })
      return errorResponse('验证码邮件发送失败，请稍后重试', 'EMAIL_SEND_FAILED', 503)
    }
  } catch (error) {
    await prisma.emailVerification.updateMany({
      where: { userId: guard.user.id, email, usedAt: null },
      data: { usedAt: new Date() },
    }).catch(() => undefined)
    if (isMailFailure(error)) {
      logMailFailure(error, { route: '/api/users/me/email-verification/send', mailType: 'profile_email_code' })
    } else {
      console.error('[users.me.email-verification.send]', error instanceof Error ? error.message : 'unknown_error')
    }
    return errorResponse('验证码邮件发送失败，请稍后重试', 'EMAIL_SEND_FAILED', 503)
  }

  return NextResponse.json({
    message: '验证码已发送，请查收邮件',
    code: 'EMAIL_CODE_SENT',
    expiresAt: verification.expiresAt.toISOString(),
  }, { headers: noStoreHeaders })
}
