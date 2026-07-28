import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability, verifySecurityAnswers } from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import { checkRateLimit, consumeRateLimit, getClientIp, recordRateLimitHit, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const requestLimit = await consumeRateLimit(`ip:${ip}`, 'password-reset:answer-attempt', 20, 15 * 60)
  if (requestLimit.limited) return NextResponse.json({ message: '验证请求过于频繁，请稍后再试' }, { status: 429 })
  const body = await request.json().catch(() => null)
  const challenge = normalizeText(body?.challenge)
  if (!challenge) return NextResponse.json({ message: '验证请求无效或已过期' }, { status: 400 })
  const settings = await getAccountSecuritySettings()
  if (!settings.enableSecurityQuestionRecovery) {
    return NextResponse.json({ message: '系统密保问题找回功能已关闭，请使用其他可用方式或联系管理员。' }, { status: 403 })
  }
  const record = await prisma.passwordResetToken.findFirst({
    where: { tokenHash: hashToken(challenge), type: 'SECURITY_QUESTION', stage: 'CHALLENGE', consumedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, userId: true, attemptCount: true, User: { select: { securityQuestionRecoveryEnabled: true, UserSecurityQuestion: { select: { sortOrder: true, answerHash: true } } } } },
  })
  const availability = getSecurityQuestionRecoveryAvailability({
    globalEnabled: settings.enableSecurityQuestionRecovery,
    userEnabled: record?.User.securityQuestionRecoveryEnabled || false,
    questionCount: record?.User.UserSecurityQuestion ? 1 : 0,
  })
  if (!record || !availability.available) {
    return NextResponse.json({ message: '当前账号未启用密保问题找回，请联系管理员或使用其他可用方式。' }, { status: 403 })
  }
  const accountKey = `account:${hashToken(record.userId)}`
  const lock = await checkRateLimit(accountKey, 'password-reset:wrong-answer', 5)
  if (lock.limited) return NextResponse.json({ message: '验证失败次数过多，请稍后再试', retryAfter: lock.retryAfter }, { status: 429 })
  const valid = await verifySecurityAnswers(record.User.UserSecurityQuestion ? [record.User.UserSecurityQuestion] : [], body?.answers)
  if (!valid) {
    await Promise.all([
      recordRateLimitHit(accountKey, 'password-reset:wrong-answer', 30 * 60),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { attemptCount: { increment: 1 } } }),
    ])
    return NextResponse.json({ message: '密保答案验证失败' }, { status: 400 })
  }
  const resetToken = createPlainToken()
  const result = await prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
    if (consumed.count !== 1) return false
    await tx.rateLimitLog.deleteMany({ where: { key: accountKey, action: 'password-reset:wrong-answer' } })
    await tx.passwordResetToken.create({ data: { userId: record.userId, type: 'SECURITY_QUESTION', stage: 'RESET_TOKEN', tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } })
    return true
  })
  if (!result) return NextResponse.json({ message: '验证请求已使用' }, { status: 409 })
  return NextResponse.json({ message: '验证成功，请设置新密码', resetToken })
}
