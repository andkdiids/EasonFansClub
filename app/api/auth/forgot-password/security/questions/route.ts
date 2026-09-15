import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, getSecurityQuestionRecoveryAvailability, type AccountSecuritySettings } from '@/lib/account-security'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'
import { getLoginIdentifierWhere } from '@/lib/users'

const genericMessage = '如果账号可使用密保找回，系统将进入下一步。'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const limit = await consumeRateLimit(`ip:${ip}`, 'password-reset:questions', 12, 15 * 60)
  if (limit.limited) return NextResponse.json({ message: '请求过于频繁，请稍后再试', retryAfter: limit.retryAfter }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier)
  if (!identifier) return NextResponse.json({ code: 'IDENTIFIER_REQUIRED', message: '请输入账号标识', errors: { identifier: '请输入账号标识' } }, { status: 400 })
  let settings: AccountSecuritySettings
  try {
    settings = await getAccountSecuritySettings()
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/questions', error, { stage: 'settings' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法开始密码找回，请稍后重试' }, { status: 503 })
  }
  if (!settings.enableSecurityQuestionRecovery) return NextResponse.json({ message: '系统密保问题找回功能已关闭，请使用其他可用方式或联系管理员。' }, { status: 403 })
  let user: { id: string; securityQuestionRecoveryEnabled: boolean; UserSecurityQuestion: { question: string; sortOrder: number } | null } | null
  try {
    user = await prisma.user.findFirst({
      where: { isDeleted: false, status: 'ACTIVE', ...getLoginIdentifierWhere(identifier) },
      select: { id: true, securityQuestionRecoveryEnabled: true, UserSecurityQuestion: { select: { question: true, sortOrder: true } } },
    })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/questions', error, { stage: 'user_lookup' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法开始密码找回，请稍后重试' }, { status: 503 })
  }
  const availability = getSecurityQuestionRecoveryAvailability({
    globalEnabled: settings.enableSecurityQuestionRecovery,
    userEnabled: user?.securityQuestionRecoveryEnabled || false,
    questionCount: user?.UserSecurityQuestion ? 1 : 0,
  })
  if (!user || !availability.available) {
    return NextResponse.json({
      message: '当前账号未启用密保问题找回，请联系管理员或使用其他可用方式。',
      securityRecoveryUnavailable: true,
      emailAlternativeAvailable: settings.enableEmailPasswordReset,
    })
  }
  const challenge = createPlainToken()
  try {
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({ where: { userId: user.id, type: 'SECURITY_QUESTION', stage: 'CHALLENGE', consumedAt: null }, data: { consumedAt: new Date() } }),
      prisma.passwordResetToken.create({ data: { userId: user.id, type: 'SECURITY_QUESTION', stage: 'CHALLENGE', tokenHash: hashToken(challenge), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } }),
    ])
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/security/questions', error, { stage: 'challenge_create' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法开始密码找回，请稍后重试' }, { status: 503 })
  }
  return NextResponse.json({ message: genericMessage, challenge, questions: user.UserSecurityQuestion ? [user.UserSecurityQuestion] : [] })
}
