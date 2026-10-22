import { NextResponse } from 'next/server'
import {
  hashSecurityQuestions,
  parseSecurityQuestions,
  securityQuestionNotificationKey,
  validateSecurityQuestions,
} from '@/lib/account-security'
import { verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { consumeRateLimitFailClosed, getClientIp, rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

async function enforceSecurityQuestionWriteLimit(request: Request, userId: string) {
  const ipLimit = await consumeRateLimitFailClosed(`ip:${getClientIp(request)}`, 'account-security-question-write', 20, 15 * 60).catch(() => null)
  if (!ipLimit) return NextResponse.json({ message: '暂时无法安全更新密保问题，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (ipLimit.limited) return NextResponse.json({ message: '操作过于频繁，请稍后再试' }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(ipLimit.retryAfter || 1) },
  })
  const accountLimit = await consumeRateLimitFailClosed(`account:${hashToken(userId)}`, 'account-security-question-write-user', 5, 15 * 60).catch(() => null)
  if (!accountLimit) return NextResponse.json({ message: '暂时无法安全更新密保问题，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (accountLimit.limited) return NextResponse.json({ message: '操作过于频繁，请稍后再试' }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(accountLimit.retryAfter || 1) },
  })
  return null
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limitResponse = await enforceSecurityQuestionWriteLimit(request, guard.user.id)
  if (limitResponse) return limitResponse
  const body = await request.json().catch(() => null)
  const questions = parseSecurityQuestions(body?.securityQuestions)
  const validationError = validateSecurityQuestions(questions)
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400 })
  const hashed = await hashSecurityQuestions(questions)
  try {
    await prisma.$transaction(async (tx) => {
      const count = await tx.userSecurityQuestion.count({ where: { userId: guard.user.id } })
      if (count >= 1) throw new Error('SECURITY_QUESTIONS_ALREADY_SET')
      await tx.userSecurityQuestion.create({ data: { ...hashed[0], userId: guard.user.id } })
      await tx.user.update({ where: { id: guard.user.id }, data: { securityQuestionRecoveryEnabled: true } })
      await tx.accountSecurityLog.create({
        data: { userId: guard.user.id, action: 'SECURITY_QUESTIONS_SET', ipAddress: getClientIp(request) },
      })
    }, { timeout: 15_000, maxWait: 5_000 })
  } catch (error) {
    if (error instanceof Error && error.message === 'SECURITY_QUESTIONS_ALREADY_SET') {
      return NextResponse.json({ message: '密保问题已设置，不允许再次修改' }, { status: 409 })
    }
    throw error
  }
  await safeNotificationWrite(
    () => prisma.notification.updateMany({
      where: { recipientId: guard.user.id, key: securityQuestionNotificationKey, completedAt: null },
      data: { completedAt: new Date(), isRead: true, readAt: new Date() },
    }),
    { operation: 'security-questions-completed', userId: guard.user.id, notificationType: 'SYSTEM' },
  )
  emitRealtime(guard.user.id, 'notification')
  return NextResponse.json({ message: '密保问题设置成功' }, { status: 201, headers: noStoreHeaders })
}

export async function PUT(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limitResponse = await enforceSecurityQuestionWriteLimit(request, guard.user.id)
  if (limitResponse) return limitResponse

  const body = await request.json().catch(() => null)
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const questions = parseSecurityQuestions(body?.securityQuestions)
  const validationError = validateSecurityQuestions(questions)
  if (!currentPassword) return NextResponse.json({ code: 'CURRENT_PASSWORD_REQUIRED', message: '请输入当前密码' }, { status: 400, headers: noStoreHeaders })
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400, headers: noStoreHeaders })

  const user = await prisma.user.findUnique({ where: { id: guard.user.id }, select: { passwordHash: true } })
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED', message: '当前登录状态无效，请重新登录' }, { status: 401, headers: noStoreHeaders })
  if (!(await verifyPassword(currentPassword, user.passwordHash)).valid) {
    return NextResponse.json({ code: 'CURRENT_PASSWORD_INVALID', message: '当前密码不正确' }, { status: 400, headers: noStoreHeaders })
  }

  const hashed = await hashSecurityQuestions(questions)
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.userSecurityQuestion.findUnique({ where: { userId: guard.user.id }, select: { id: true } })
      if (!existing) throw new Error('SECURITY_QUESTION_NOT_SET')
      await tx.userSecurityQuestion.update({ where: { userId: guard.user.id }, data: hashed[0] })
      await tx.accountSecurityLog.create({
        data: { userId: guard.user.id, action: 'SECURITY_QUESTIONS_UPDATED', ipAddress: getClientIp(request) },
      })
    }, { timeout: 15_000, maxWait: 5_000 })
  } catch (error) {
    if (error instanceof Error && error.message === 'SECURITY_QUESTION_NOT_SET') {
      return NextResponse.json({ code: 'SECURITY_QUESTION_NOT_SET', message: '请先设置密保问题' }, { status: 409, headers: noStoreHeaders })
    }
    throw error
  }

  return NextResponse.json({ message: '密保问题已更新' }, { headers: noStoreHeaders })
}
