import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability, verifySecurityAnswers, type AccountSecuritySettings } from '@/lib/account-security'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const requestLimit = await consumeRateLimit(`ip:${ip}`, 'password-reset:answer-attempt', 20, 15 * 60)
  if (requestLimit.limited) return NextResponse.json({ message: '验证请求过于频繁，请稍后再试' }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(requestLimit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const challenge = normalizeText(body?.challenge)
  if (!challenge) return NextResponse.json({ code: 'RESET_CHALLENGE_INVALID', message: '验证请求无效或已过期', errors: { challenge: '验证请求无效或已过期' } }, { status: 400 })
  let settings: AccountSecuritySettings
  try {
    settings = await getAccountSecuritySettings()
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'settings' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503 })
  }
  if (!settings.enableSecurityQuestionRecovery) {
    return NextResponse.json({ message: '系统密保问题找回功能已关闭，请使用其他可用方式或联系管理员。' }, { status: 403 })
  }
  let record: {
    id: string
    userId: string
    attemptCount: number
    User: {
      securityQuestionRecoveryEnabled: boolean
      UserSecurityQuestion: { sortOrder: number; answerHash: string } | null
    }
  } | null
  try {
    record = await prisma.passwordResetToken.findFirst({
      where: { tokenHash: hashToken(challenge), type: 'SECURITY_QUESTION', stage: 'CHALLENGE', consumedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true, attemptCount: true, User: { select: { securityQuestionRecoveryEnabled: true, UserSecurityQuestion: { select: { sortOrder: true, answerHash: true } } } } },
    })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'challenge_lookup' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503 })
  }
  const availability = getSecurityQuestionRecoveryAvailability({
    globalEnabled: settings.enableSecurityQuestionRecovery,
    userEnabled: record?.User.securityQuestionRecoveryEnabled || false,
    questionCount: record?.User.UserSecurityQuestion ? 1 : 0,
  })
  if (!record || !availability.available) {
    return NextResponse.json({ message: '当前账号未启用密保问题找回，请联系管理员或使用其他可用方式。' }, { status: 403 })
  }
  const accountKey = `account:${hashToken(record.userId)}`
  const lock = await consumeRateLimit(accountKey, 'password-reset:wrong-answer', 5, 30 * 60)
  if (lock.limited) return NextResponse.json({ message: '验证失败次数过多，请稍后再试', retryAfter: lock.retryAfter }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(lock.retryAfter || 1) },
  })
  let valid = false
  try {
    valid = await verifySecurityAnswers(record.User.UserSecurityQuestion ? [record.User.UserSecurityQuestion] : [], body?.answers)
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'answer_verify' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503 })
  }
  if (!valid) {
    try {
      await prisma.passwordResetToken.update({ where: { id: record.id }, data: { attemptCount: { increment: 1 } } })
    } catch (error) {
      logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'failed_answer_record' })
      return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503 })
    }
    return NextResponse.json({ code: 'SECURITY_ANSWER_INVALID', message: '密保答案不正确', errors: { answer: '密保答案不正确' } }, { status: 400 })
  }
  const resetToken = createPlainToken()
  try {
    const result = await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
      if (consumed.count !== 1) return false
      await tx.rateLimitLog.deleteMany({ where: { key: accountKey, action: 'password-reset:wrong-answer' } })
      await tx.passwordResetToken.create({ data: { userId: record.userId, type: 'SECURITY_QUESTION', stage: 'RESET_TOKEN', tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } })
      return true
    })
    if (!result) return NextResponse.json({ code: 'RESET_CHALLENGE_USED', message: '验证请求已使用', errors: { challenge: '验证请求已使用' } }, { status: 409 })
    return NextResponse.json({ message: '验证成功，请设置新密码', resetToken })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'reset_token_create' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法完成密保验证，请稍后重试' }, { status: 503 })
  }
}
