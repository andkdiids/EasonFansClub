import { NextResponse } from 'next/server'
import { getNewPasswordValidationError, validateNewPassword } from '@/lib/account-password'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { hashPassword } from '@/lib/password'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { PasswordChangeConflictError, consumeResetTokenAndChangePassword } from '@/lib/password-security-transaction'
import { prisma } from '@/lib/prisma'
import { consumeRateLimitFailClosed, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const limit = await consumeRateLimitFailClosed(`ip:${ip}`, 'password-reset:commit', 10, 15 * 60).catch(() => null)
  if (!limit) return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法完成密码重置，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (limit.limited) return NextResponse.json({ message: '请求过于频繁，请稍后再试' }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(limit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const token = normalizeText(body?.resetToken || body?.token)
  const password = typeof body?.password === 'string' ? body.password : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : ''
  const passwordError = validateNewPassword(password, confirmPassword)
  const passwordDetails = getNewPasswordValidationError(password, confirmPassword)
  if (!token) {
    return NextResponse.json({ code: 'RESET_TOKEN_INVALID', message: '重置凭证无效或已过期', errors: { resetToken: '重置凭证无效或已过期' } }, { status: 400, headers: noStoreHeaders })
  }
  if (passwordError) {
    return NextResponse.json({ code: passwordDetails?.code || 'PASSWORD_INVALID', message: passwordError, errors: { [passwordDetails?.field || 'password']: passwordError } }, { status: 400, headers: noStoreHeaders })
  }

  try {
    const reset = await prisma.passwordResetToken.findFirst({ where: { tokenHash: hashToken(token), type: 'SECURITY_QUESTION', stage: 'RESET_TOKEN', consumedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, userId: true, type: true, User: { select: { passwordHash: true } } } })
    if (!reset) return NextResponse.json({ code: 'RESET_TOKEN_INVALID', message: '重置凭证无效或已过期', errors: { resetToken: '重置凭证无效或已过期' } }, { status: 400, headers: noStoreHeaders })
    const passwordHash = await hashPassword(password)
    const now = new Date()
    const committed = await prisma.$transaction((tx) => consumeResetTokenAndChangePassword(tx, {
      resetTokenId: reset.id,
      resetTokenType: reset.type,
      userId: reset.userId,
      expectedPasswordHash: reset.User.passwordHash,
      passwordHash,
      action: 'PASSWORD_RESET_SUCCEEDED',
      method: reset.type,
      ipAddress: ip,
      userAgent: request.headers.get('user-agent')?.slice(0, 500) || null,
      now,
    }), { timeout: 15_000, maxWait: 5_000 })
    if (!committed) return NextResponse.json({ code: 'RESET_TOKEN_USED', message: '重置凭证已经使用', errors: { resetToken: '重置凭证已经使用' } }, { status: 409, headers: noStoreHeaders })
    invalidateCurrentUserCache(reset.userId)
    return NextResponse.json({ message: '密码已重置，请使用新密码登录' }, { headers: noStoreHeaders })
  } catch (error) {
    if (error instanceof PasswordChangeConflictError) return NextResponse.json({ code: 'RESET_TOKEN_INVALID', message: '重置凭证无效或已过期', errors: { resetToken: '重置凭证无效或已过期' } }, { status: 409, headers: noStoreHeaders })
    logPasswordRecoveryError('/api/auth/forgot-password/reset', error, { stage: 'commit' })
    return NextResponse.json({ code: 'PASSWORD_RESET_FAILED', message: '密码重置失败，请稍后重试' }, { status: 500, headers: noStoreHeaders })
  }
}
