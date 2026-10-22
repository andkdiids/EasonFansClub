import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability, type AccountSecuritySettings } from '@/lib/account-security'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { prisma } from '@/lib/prisma'
import { consumeRateLimitFailClosed, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'
import { getLoginIdentifierWhere } from '@/lib/users'

const genericMessage = '如果账号可使用密保找回，请输入你设置的密保答案。'
const genericQuestion = '请输入设置密保时保存的答案'
const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function challengeResponse(challenge: string) {
  return NextResponse.json({
    message: genericMessage,
    challenge,
    questions: [{ question: genericQuestion, sortOrder: 1 }],
  }, { headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const limit = await consumeRateLimitFailClosed(`ip:${ip}`, 'password-reset:questions', 12, 15 * 60).catch(() => null)
  if (!limit) return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法开始密码找回，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (limit.limited) return NextResponse.json({ message: '请求过于频繁，请稍后再试', retryAfter: limit.retryAfter }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(limit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier)
  if (!identifier) return NextResponse.json({ code: 'IDENTIFIER_REQUIRED', message: '请输入账号标识', errors: { identifier: '请输入账号标识' } }, { status: 400, headers: noStoreHeaders })
  let settings: AccountSecuritySettings
  try {
    settings = await getAccountSecuritySettings()
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/questions', error, { stage: 'settings' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法开始密码找回，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  const challenge = createPlainToken()
  if (!settings.enableSecurityQuestionRecovery) return challengeResponse(challenge)
  let user: { id: string; securityQuestionRecoveryEnabled: boolean; UserSecurityQuestion: { id: string } | null } | null
  try {
    user = await prisma.user.findFirst({
      where: { isDeleted: false, status: 'ACTIVE', ...getLoginIdentifierWhere(identifier) },
      select: { id: true, securityQuestionRecoveryEnabled: true, UserSecurityQuestion: { select: { id: true } } },
    })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/questions', error, { stage: 'user_lookup' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法开始密码找回，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  const availability = getSecurityQuestionRecoveryAvailability({
    globalEnabled: settings.enableSecurityQuestionRecovery,
    userEnabled: user?.securityQuestionRecoveryEnabled || false,
    questionCount: user?.UserSecurityQuestion ? 1 : 0,
  })
  if (!user || !availability.available) return challengeResponse(challenge)
  try {
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { userId: user.id, type: 'SECURITY_QUESTION', stage: 'CHALLENGE', consumedAt: null }, data: { consumedAt: new Date() } }),
      prisma.passwordResetToken.create({ data: { userId: user.id, type: 'SECURITY_QUESTION', stage: 'CHALLENGE', tokenHash: hashToken(challenge), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } }),
    ])
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/questions', error, { stage: 'challenge_create' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法开始密码找回，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  return challengeResponse(challenge)
}
