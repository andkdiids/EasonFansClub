import crypto from 'crypto'
import { NextResponse } from 'next/server'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { sendPasswordResetCode } from '@/lib/mail'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'
import { normalizeLoginAccount } from '@/lib/login-account'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const settings = await getAccountSecuritySettings()
  if (!settings.enableEmailPasswordReset) return NextResponse.json({ message: '邮箱重置功能暂未开放' }, { status: 403 })
  const ip = getClientIp(request)
  const ipLimit = await consumeRateLimit(`ip:${ip}`, 'password-reset:email-send', 8, 60 * 60)
  if (ipLimit.limited) return NextResponse.json({ message: '发送过于频繁，请稍后再试' }, { status: 429 })
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier)
  if (!identifier) return NextResponse.json({ message: '请输入账号标识' }, { status: 400 })
  const user = await prisma.user.findFirst({ where: { isDeleted: false, status: 'ACTIVE', emailVerifiedAt: { not: null }, OR: [
    { usernameNormalized: normalizeLoginAccount(identifier) }, { email: { equals: identifier, mode: 'insensitive' } }, { phone: identifier },
  ] }, select: { id: true, email: true } })
  const genericMessage = '如果账号存在且邮箱已验证，验证码将发送到绑定邮箱。'
  if (!user?.email) return NextResponse.json({ message: genericMessage })
  const userLimit = await consumeRateLimit(`account:${hashToken(user.id)}`, 'password-reset:email-send', 3, 60 * 60)
  if (userLimit.limited) return NextResponse.json({ message: genericMessage })
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const record = await prisma.passwordResetToken.create({ data: {
    userId: user.id, type: 'EMAIL', stage: 'RESET_CODE', tokenHash: hashToken(createPlainToken()), codeHash: hashToken(`${user.id}:${code}`), expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  } })
  try {
    const sent = await sendPasswordResetCode(user.email, code)
    if (!sent.sent) {
      await prisma.passwordResetToken.delete({ where: { id: record.id } })
      return NextResponse.json({ message: '邮件服务未配置' }, { status: 503 })
    }
  } catch (error) {
    await prisma.passwordResetToken.deleteMany({ where: { id: record.id } })
    if (error instanceof Error && error.message === 'EMAIL_SEND_NOT_CONFIGURED') return NextResponse.json({ message: '邮件服务未配置' }, { status: 503 })
    return NextResponse.json({ message: '邮件发送失败，请稍后再试' }, { status: 502 })
  }
  return NextResponse.json({ message: genericMessage })
}
