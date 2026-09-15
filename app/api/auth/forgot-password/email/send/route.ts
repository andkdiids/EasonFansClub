import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { isMailFailure, logMailFailure, sendPasswordResetCode } from '@/lib/mail'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'
import { getLoginIdentifierWhere } from '@/lib/users'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  let settings
  try {
    settings = await getAccountSecuritySettings()
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/email/send', error, { stage: 'settings' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法发送重置邮件，请稍后重试' }, { status: 503 })
  }
  if (!settings.enableEmailPasswordReset) return NextResponse.json({ message: '邮箱重置功能暂未开放' }, { status: 403 })
  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`ip:${ip}`, 'password-reset:email-send', 8, 60 * 60)
  if (ipLimit.limited) return NextResponse.json({ message: '发送过于频繁，请稍后再试' }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(ipLimit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier)
  if (!identifier) return NextResponse.json({ code: 'IDENTIFIER_REQUIRED', message: '请输入账号标识', errors: { identifier: '请输入账号标识' } }, { status: 400 })
  const genericMessage = '如果账号存在且邮箱已验证，验证码将发送到绑定邮箱。'
  let user: { id: string; email: string | null } | null
  try {
    user = await prisma.user.findFirst({ where: { isDeleted: false, status: 'ACTIVE', emailVerifiedAt: { not: null }, ...getLoginIdentifierWhere(identifier) }, select: { id: true, email: true } })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/email/send', error, { stage: 'user_lookup' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法发送重置邮件，请稍后重试' }, { status: 503 })
  }
  if (!user?.email) return NextResponse.json({ message: genericMessage })
  const userLimit = await consumeRateLimit(`account:${hashToken(user.id)}`, 'password-reset:email-send', 3, 60 * 60)
  if (userLimit.limited) return NextResponse.json({ message: genericMessage })
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  let record: { id: string }
  try {
    record = await prisma.passwordResetToken.create({ data: {
      userId: user.id, type: 'EMAIL', stage: 'RESET_CODE', tokenHash: hashToken(createPlainToken()), codeHash: hashToken(`${user.id}:${code}`), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }, select: { id: true } })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/email/send', error, { stage: 'reset_code_create' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法发送重置邮件，请稍后重试' }, { status: 503 })
  }
  try {
    const sent = await sendPasswordResetCode(user.email, code)
    if (!sent.sent) {
      await prisma.passwordResetToken.delete({ where: { id: record.id } }).catch((error) => logPasswordRecoveryError('/api/auth/forgot-password/email/send', error, { stage: 'reset_code_cleanup' }))
      logMailFailure(new Error('EMAIL_SEND_NOT_CONFIGURED'), { route: '/api/auth/forgot-password/email/send', mailType: 'password_reset_code' })
      return NextResponse.json({ message: '邮件发送失败，请稍后重试', code: 'EMAIL_SEND_FAILED' }, { status: 503 })
    }
  } catch (error) {
    await prisma.passwordResetToken.deleteMany({ where: { id: record.id } }).catch((cleanupError) => logPasswordRecoveryError('/api/auth/forgot-password/email/send', cleanupError, { stage: 'reset_code_cleanup' }))
    if (isMailFailure(error)) {
      logMailFailure(error, { route: '/api/auth/forgot-password/email/send', mailType: 'password_reset_code' })
    }
    const status = error instanceof Error && error.message === 'EMAIL_SEND_NOT_CONFIGURED' ? 503 : 502
    return NextResponse.json({ message: '邮件发送失败，请稍后重试', code: 'EMAIL_SEND_FAILED' }, { status })
  }
  return NextResponse.json({ message: genericMessage })
}
