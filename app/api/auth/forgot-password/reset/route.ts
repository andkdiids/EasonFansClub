import { NextResponse } from 'next/server'
import { getNewPasswordValidationError, validateNewPassword } from '@/lib/account-password'
import { hashPassword } from '@/lib/password'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const ip = getClientIp(request)
  const limit = await consumeRateLimit(`ip:${ip}`, 'password-reset:commit', 10, 15 * 60)
  if (limit.limited) return NextResponse.json({ message: '请求过于频繁，请稍后再试' }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const token = normalizeText(body?.resetToken || body?.token)
  const password = typeof body?.password === 'string' ? body.password : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : ''
  const passwordError = validateNewPassword(password, confirmPassword)
  const passwordDetails = getNewPasswordValidationError(password, confirmPassword)
  if (!token) {
    return NextResponse.json({ code: 'RESET_TOKEN_INVALID', message: '重置凭证无效或已过期', errors: { resetToken: '重置凭证无效或已过期' } }, { status: 400 })
  }
  if (passwordError) {
    return NextResponse.json({ code: passwordDetails?.code || 'PASSWORD_INVALID', message: passwordError, errors: { [passwordDetails?.field || 'password']: passwordError } }, { status: 400 })
  }

  try {
    const reset = await prisma.passwordResetToken.findFirst({ where: { tokenHash: hashToken(token), type: { not: 'EMAIL_LINK' }, stage: 'RESET_TOKEN', consumedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, userId: true, type: true } })
    if (!reset) return NextResponse.json({ code: 'RESET_TOKEN_INVALID', message: '重置凭证无效或已过期', errors: { resetToken: '重置凭证无效或已过期' } }, { status: 400 })
    const passwordHash = await hashPassword(password)
    const committed = await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: reset.id, type: { not: 'EMAIL_LINK' }, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } })
      if (consumed.count !== 1) return false
      await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } })
      await tx.passwordResetToken.updateMany({ where: { userId: reset.userId, consumedAt: null }, data: { consumedAt: new Date() } })
      await tx.onlineSession.deleteMany({ where: { userId: reset.userId } })
      await tx.accountSecurityLog.create({ data: { userId: reset.userId, action: 'PASSWORD_RESET_SUCCEEDED', ipAddress: ip, userAgent: request.headers.get('user-agent')?.slice(0, 500), metadata: { method: reset.type } } })
      return true
    })
    if (!committed) return NextResponse.json({ code: 'RESET_TOKEN_USED', message: '重置凭证已经使用', errors: { resetToken: '重置凭证已经使用' } }, { status: 409 })
    return NextResponse.json({ message: '密码已重置，请使用新密码登录' })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/reset', error, { stage: 'commit' })
    return NextResponse.json({ code: 'PASSWORD_RESET_FAILED', message: '密码重置失败，请稍后重试' }, { status: 500 })
  }
}
