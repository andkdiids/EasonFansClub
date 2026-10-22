import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability, verifySecurityAnswers, type AccountSecuritySettings } from '@/lib/account-security'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { prisma } from '@/lib/prisma'
import { consumeRateLimitFailClosed, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function invalidChallengeResponse() {
  return NextResponse.json({
    code: 'RESET_CHALLENGE_INVALID',
    message: '验证请求无效或密保答案不正确。如仍无法完成，请联系管理员协助恢复账号。',
    errors: { answer: '验证请求无效或密保答案不正确。如仍无法完成，请联系管理员协助恢复账号。' },
  }, { status: 400, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const requestLimit = await consumeRateLimitFailClosed(`ip:${ip}`, 'password-reset:answer-attempt', 20, 15 * 60).catch(() => null)
  if (!requestLimit) return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (requestLimit.limited) return NextResponse.json({ message: '验证请求过于频繁，请稍后再试' }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(requestLimit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const challenge = normalizeText(body?.challenge)
  if (!challenge) return invalidChallengeResponse()
  let settings: AccountSecuritySettings
  try {
    settings = await getAccountSecuritySettings()
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'settings' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  if (!settings.enableSecurityQuestionRecovery) return invalidChallengeResponse()
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
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  const availability = getSecurityQuestionRecoveryAvailability({
    globalEnabled: settings.enableSecurityQuestionRecovery,
    userEnabled: record?.User.securityQuestionRecoveryEnabled || false,
    questionCount: record?.User.UserSecurityQuestion ? 1 : 0,
  })
  if (!record || !availability.available || record.attemptCount >= 5) return invalidChallengeResponse()
  const accountKey = `account:${hashToken(record.userId)}`
  const lock = await consumeRateLimitFailClosed(accountKey, 'password-reset:wrong-answer', 5, 30 * 60).catch(() => null)
  if (!lock) return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (lock.limited) return invalidChallengeResponse()
  let valid = false
  try {
    valid = await verifySecurityAnswers(record.User.UserSecurityQuestion ? [record.User.UserSecurityQuestion] : [], body?.answers)
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'answer_verify' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  if (!valid) {
    try {
      const attemptedAt = new Date()
      const attempt = await prisma.passwordResetToken.updateMany({
        where: {
          id: record.id,
          type: 'SECURITY_QUESTION',
          stage: 'CHALLENGE',
          consumedAt: null,
          expiresAt: { gt: attemptedAt },
          attemptCount: { equals: record.attemptCount, lt: 5 },
        },
        data: {
          attemptCount: { increment: 1 },
          ...(record.attemptCount >= 4 ? { consumedAt: attemptedAt } : {}),
        },
      })
      if (attempt.count !== 1) return invalidChallengeResponse()
    } catch (error) {
      logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'failed_answer_record' })
      return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证密保，请稍后重试' }, { status: 503, headers: noStoreHeaders })
    }
    return invalidChallengeResponse()
  }
  const resetToken = createPlainToken()
  try {
    const result = await prisma.$transaction(async (tx) => {
      const consumedAt = new Date()
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: record.id, userId: record.userId, type: 'SECURITY_QUESTION', stage: 'CHALLENGE', attemptCount: { equals: record.attemptCount, lt: 5 }, consumedAt: null, expiresAt: { gt: consumedAt } }, data: { consumedAt } })
      if (consumed.count !== 1) return false
      await tx.rateLimitLog.deleteMany({ where: { key: accountKey, action: 'password-reset:wrong-answer' } })
      await tx.passwordResetToken.create({ data: { userId: record.userId, type: 'SECURITY_QUESTION', stage: 'RESET_TOKEN', tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } })
      return true
    })
    if (!result) return invalidChallengeResponse()
    return NextResponse.json({ message: '验证成功，请设置新密码', resetToken }, { headers: noStoreHeaders })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/verify', error, { stage: 'reset_token_create' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法完成密保验证，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
}
