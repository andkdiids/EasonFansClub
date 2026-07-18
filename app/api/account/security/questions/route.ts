import { NextResponse } from 'next/server'
import {
  hashSecurityQuestions,
  parseSecurityQuestions,
  securityQuestionNotificationKey,
  validateSecurityQuestions,
} from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import { getClientIp, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

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
      await tx.notification.updateMany({
        where: { recipientId: guard.user.id, key: securityQuestionNotificationKey, completedAt: null },
        data: { completedAt: new Date(), isRead: true, readAt: new Date() },
      })
      await tx.accountSecurityLog.create({
        data: { userId: guard.user.id, action: 'SECURITY_QUESTIONS_SET', ipAddress: getClientIp(request) },
      })
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'SECURITY_QUESTIONS_ALREADY_SET') {
      return NextResponse.json({ message: '密保问题已设置，不允许再次修改' }, { status: 409 })
    }
    throw error
  }
  return NextResponse.json({ message: '密保问题设置成功，今后不可修改' }, { status: 201 })
}
