import { NextResponse } from 'next/server'
import { getAccountSecuritySettings } from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const settings = await getAccountSecuritySettings()
  if (!settings.enableEmailPasswordReset) return NextResponse.json({ message: '邮箱重置功能暂未开放' }, { status: 403 })
  const ip = getClientIp(request)
  const limit = await consumeRateLimit(`ip:${ip}`, 'password-reset:email-verify', 20, 15 * 60)
  if (limit.limited) return NextResponse.json({ message: '验证请求过于频繁，请稍后再试' }, { status: 429 })
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier)
  const code = normalizeText(body?.code)
  if (!identifier || !/^\d{6}$/.test(code)) return NextResponse.json({ message: '验证码无效或已过期' }, { status: 400 })
  const user = await prisma.user.findFirst({ where: { isDeleted: false, status: 'ACTIVE', emailVerifiedAt: { not: null }, OR: [
    { username: { equals: identifier, mode: 'insensitive' } }, { email: { equals: identifier, mode: 'insensitive' } }, { phone: identifier },
  ] }, select: { id: true } })
  if (!user) return NextResponse.json({ message: '验证码无效或已过期' }, { status: 400 })
  const record = await prisma.passwordResetToken.findFirst({ where: { userId: user.id, type: 'EMAIL', stage: 'RESET_CODE', consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, codeHash: true, attemptCount: true } })
  if (!record || record.attemptCount >= 5 || record.codeHash !== hashToken(`${user.id}:${code}`)) {
    if (record) await prisma.passwordResetToken.update({ where: { id: record.id }, data: { attemptCount: { increment: 1 }, ...(record.attemptCount >= 4 ? { consumedAt: new Date() } : {}) } })
    return NextResponse.json({ message: '验证码无效或已过期' }, { status: 400 })
  }
  const resetToken = createPlainToken()
  const committed = await prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({ where: { id: record.id, consumedAt: null }, data: { consumedAt: new Date() } })
    if (consumed.count !== 1) return false
    await tx.passwordResetToken.create({ data: { userId: user.id, type: 'EMAIL', stage: 'RESET_TOKEN', tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } })
    return true
  })
  if (!committed) return NextResponse.json({ message: '验证码已经使用' }, { status: 409 })
  return NextResponse.json({ message: '验证成功，请设置新密码', resetToken })
}
