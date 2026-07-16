import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability } from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

const genericMessage = '如果账号可使用密保找回，系统将进入下一步。'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const limit = await consumeRateLimit(`ip:${ip}`, 'password-reset:questions', 12, 15 * 60)
  if (limit.limited) return NextResponse.json({ message: '请求过于频繁，请稍后再试', retryAfter: limit.retryAfter }, { status: 429 })
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier)
  if (!identifier) return NextResponse.json({ message: '请输入账号标识' }, { status: 400 })
  const settings = await getAccountSecuritySettings()
  if (!settings.enableSecurityQuestionRecovery) return NextResponse.json({ message: '系统密保问题找回功能已关闭，请使用其他可用方式或联系管理员。' }, { status: 403 })
  const user = await prisma.user.findFirst({
    where: { isDeleted: false, status: 'ACTIVE', OR: [
      { username: { equals: identifier, mode: 'insensitive' } },
      { email: { equals: identifier, mode: 'insensitive' } },
      { phone: identifier },
    ] },
    select: { id: true, securityQuestionRecoveryEnabled: true, securityQuestions: { orderBy: { sortOrder: 'asc' }, select: { question: true, sortOrder: true } } },
  })
  const availability = getSecurityQuestionRecoveryAvailability({
    globalEnabled: settings.enableSecurityQuestionRecovery,
    userEnabled: user?.securityQuestionRecoveryEnabled || false,
    questionCount: user?.securityQuestions.length || 0,
  })
  if (!user || !availability.available) {
    return NextResponse.json({
      message: '当前账号未启用密保问题找回，请联系管理员或使用其他可用方式。',
      securityRecoveryUnavailable: true,
      emailAlternativeAvailable: settings.enableEmailPasswordReset,
    })
  }
  const challenge = createPlainToken()
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, type: 'SECURITY_QUESTION', stage: 'CHALLENGE', consumedAt: null }, data: { consumedAt: new Date() } }),
    prisma.passwordResetToken.create({ data: { userId: user.id, type: 'SECURITY_QUESTION', stage: 'CHALLENGE', tokenHash: hashToken(challenge), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } }),
  ])
  return NextResponse.json({ message: genericMessage, challenge, questions: user.securityQuestions })
}
