import { NextResponse } from 'next/server'
import { hashPassword } from '@/lib/password'
import { validateNewPassword } from '@/lib/account-password'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const ip = getClientIp(request)
  const limit = await consumeRateLimit(`ip:${ip}`, 'password-reset:link-reset', 10, 15 * 60)
  if (limit.limited) return NextResponse.json({ message: '请求过于频繁，请稍后再试' }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(limit.retryAfter || 1) },
  })

  const body = await request.json().catch(() => null)
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : typeof body?.password === 'string' ? body.password : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : newPassword
  const passwordError = validateNewPassword(newPassword, confirmPassword)
  if (!token || passwordError) {
    return NextResponse.json({ message: passwordError || '重置链接无效或已过期' }, { status: 400, headers: noStoreHeaders })
  }

  const now = new Date()
  const reset = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash: hashToken(token),
      type: 'EMAIL_LINK',
      stage: 'RESET_TOKEN',
      consumedAt: null,
      expiresAt: { gt: now },
    },
    select: { id: true, userId: true },
  })
  if (!reset) return NextResponse.json({ message: '重置链接无效或已过期' }, { status: 400, headers: noStoreHeaders })

  const passwordHash = await hashPassword(newPassword)
  const committed = await prisma.$transaction(async (tx) => {
    const consumed = await tx.passwordResetToken.updateMany({
      where: { id: reset.id, type: 'EMAIL_LINK', stage: 'RESET_TOKEN', consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    })
    if (consumed.count !== 1) return false
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } })
    await tx.passwordResetToken.updateMany({ where: { userId: reset.userId, consumedAt: null }, data: { consumedAt: now } })
    await tx.onlineSession.deleteMany({ where: { userId: reset.userId } })
    await tx.accountSecurityLog.create({
      data: {
        userId: reset.userId,
        action: 'PASSWORD_RESET_SUCCEEDED',
        ipAddress: ip,
        userAgent: request.headers.get('user-agent')?.slice(0, 500),
        metadata: { method: 'EMAIL_LINK' },
      },
    })
    return true
  })

  if (!committed) return NextResponse.json({ message: '重置链接已经使用' }, { status: 409, headers: noStoreHeaders })
  return NextResponse.json({ message: '密码修改成功，请重新登录' }, { headers: noStoreHeaders })
}
