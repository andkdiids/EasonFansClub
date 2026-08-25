import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { validateNewPassword } from '@/lib/account-password'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const ip = getClientIp(request)
  const limit = await consumeRateLimit(`ip:${ip}`, 'account-password-change', 10, 15 * 60)
  if (limit.limited) return NextResponse.json({ message: '操作过于频繁，请稍后再试' }, {
    status: 429,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': String(limit.retryAfter || 1) },
  })

  const body = await request.json().catch(() => null)
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const validationError = validateNewPassword(body?.password, body?.confirmPassword)
  if (!currentPassword) return NextResponse.json({ message: '请输入当前密码' }, { status: 400 })
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: guard.user.id }, select: { id: true, passwordHash: true } })
  if (!user) return NextResponse.json({ message: '用户不存在' }, { status: 404 })
  const currentResult = await verifyPassword(currentPassword, user.passwordHash)
  if (!currentResult.valid) return NextResponse.json({ message: '当前密码不正确' }, { status: 400 })
  const samePassword = await verifyPassword(body.password, user.passwordHash)
  if (samePassword.valid) return NextResponse.json({ message: '新密码不能与当前密码相同' }, { status: 400 })

  const passwordHash = await bcrypt.hash(body.password, 12)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash } })
    await tx.accountSecurityLog.create({ data: { userId: user.id, action: 'PASSWORD_CHANGED_WITH_CURRENT_PASSWORD', ipAddress: ip, userAgent: request.headers.get('user-agent')?.slice(0, 500), metadata: { method: 'CURRENT_PASSWORD' } } })
  }, { timeout: 15_000, maxWait: 5_000 })
  await safeNotificationWrite(
    () => createNotification({ data: { recipientId: user.id, type: 'SYSTEM', title: '密码修改成功', content: '您的登录密码已通过原密码验证完成修改。如非本人操作，请及时联系管理员。', link: '/settings/security' } }),
    { operation: 'password-changed', userId: user.id, notificationType: 'SYSTEM' },
  )
  emitRealtime(user.id, 'notification')
  invalidateCurrentUserCache(user.id)
  return NextResponse.json({ message: '密码修改成功' })
}
