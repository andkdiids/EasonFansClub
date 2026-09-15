import { NextResponse } from 'next/server'
import { getAccountSecuritySettings } from '@/lib/account-security'
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
    logPasswordRecoveryError('/api/auth/forgot-password/email/verify', error, { stage: 'settings' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证邮箱，请稍后重试' }, { status: 503 })
  }
  if (!settings.enableEmailPasswordReset) return NextResponse.json({ message: '邮箱重置功能暂未开放' }, { status: 403 })
  const ip = getClientIp(request)
  const limit = await consumeRateLimit(`ip:${ip}`, 'password-reset:email-verify', 20, 15 * 60)
  if (limit.limited) return NextResponse.json({ message: '验证请求过于频繁，请稍后再试' }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limit.retryAfter || 1) },
  })
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier)
  const code = normalizeText(body?.code)
  if (!identifier || !/^\d{6}$/.test(code)) return NextResponse.json({ code: 'EMAIL_CODE_INVALID', message: '验证码无效或已过期', errors: { ...(!identifier ? { identifier: '请输入账号标识' } : {}), ...(!/^\d{6}$/.test(code) ? { code: '请输入 6 位验证码' } : {}) } }, { status: 400 })
  let user: { id: string } | null
  try {
    user = await prisma.user.findFirst({ where: { isDeleted: false, status: 'ACTIVE', emailVerifiedAt: { not: null }, ...getLoginIdentifierWhere(identifier) }, select: { id: true } })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/email/verify', error, { stage: 'user_lookup' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证邮箱，请稍后重试' }, { status: 503 })
  }
  if (!user) return NextResponse.json({ code: 'EMAIL_CODE_INVALID', message: '验证码无效或已过期', errors: { code: '验证码无效或已过期' } }, { status: 400 })
  let record: { id: string; codeHash: string | null; attemptCount: number } | null
  try {
    record = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, type: 'EMAIL', stage: 'RESET_CODE', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, codeHash: true, attemptCount: true } })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/email/verify', error, { stage: 'reset_code_lookup' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证邮箱，请稍后重试' }, { status: 503 })
  }
  if (!record || record.attemptCount >= 5 || record.codeHash !== hashToken(`${user.id}:${code}`)) {
    if (record) {
      try {
        await prisma.passwordResetToken.update({ where: { id: record.id }, data: { attemptCount: { increment: 1 }, ...(record.attemptCount >= 4 ? { consumedAt: new Date() } : {}) } })
      } catch (error) {
        logPasswordRecoveryError('/api/auth/forgot-password/email/verify', error, { stage: 'failed_code_record' })
        return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法验证邮箱，请稍后重试' }, { status: 503 })
      }
    }
    return NextResponse.json({ message: '验证码无效或已过期' }, { status: 400 })
  }
  const resetToken = createPlainToken()
  try {
    const committed = await prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
      if (consumed.count !== 1) return false
      await tx.passwordResetToken.create({ data: { userId: user.id, type: 'EMAIL', stage: 'RESET_TOKEN', tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } })
      return true
    })
    if (!committed) return NextResponse.json({ code: 'RESET_TOKEN_USED', message: '验证码已经使用', errors: { code: '验证码已经使用' } }, { status: 409 })
    return NextResponse.json({ message: '验证成功，请设置新密码', resetToken })
  } catch (error) {
    logPasswordRecoveryError('/api/auth/forgot-password/email/verify', error, { stage: 'reset_token_create' })
    return NextResponse.json({ code: 'PASSWORD_RECOVERY_UNAVAILABLE', message: '暂时无法完成邮箱验证，请稍后重试' }, { status: 503 })
  }
}
