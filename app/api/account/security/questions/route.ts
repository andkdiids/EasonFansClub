import { NextResponse } from 'next/server'
import {
  hashSecurityQuestions,
  parseSecurityQuestions,
  securityQuestionNotificationKey,
  validateSecurityQuestions,
} from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { getClientIp, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { safeNotificationWrite } from '@/lib/notification-transaction'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
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
  return NextResponse.json({ message: '密保问题设置成功，今后不可修改' }, { status: 201 })
}
