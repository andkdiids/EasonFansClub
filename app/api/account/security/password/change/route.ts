import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { validateNewPassword } from '@/lib/account-password'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { verifyPassword } from '@/lib/password'
import { PasswordChangeConflictError, commitPasswordChange } from '@/lib/password-security-transaction'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { consumeRateLimitFailClosed, getClientIp, rejectInvalidRequestOrigin, requireRequestUser } from '@/lib/security'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createNotification } from '@/lib/notification-write'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const ip = getClientIp(request)
  const limit = await consumeRateLimitFailClosed(`ip:${ip}`, 'account-password-change', 10, 15 * 60).catch(() => null)
  if (!limit) return NextResponse.json({ message: '暂时无法安全修改密码，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (limit.limited) return NextResponse.json({ message: '操作过于频繁，请稍后再试' }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(limit.retryAfter || 1) },
  })
  const accountLimit = await consumeRateLimitFailClosed(`account:${hashToken(guard.user.id)}`, 'account-password-change-user', 10, 15 * 60).catch(() => null)
  if (!accountLimit) return NextResponse.json({ message: '暂时无法安全修改密码，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  if (accountLimit.limited) return NextResponse.json({ message: '操作过于频繁，请稍后再试' }, {
    status: 429,
    headers: { ...noStoreHeaders, 'Retry-After': String(accountLimit.retryAfter || 1) },
  })

  const body = await request.json().catch(() => null)
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : typeof body?.oldPassword === 'string' ? body.oldPassword : ''
  const password = typeof body?.password === 'string' ? body.password : typeof body?.newPassword === 'string' ? body.newPassword : ''
  const confirmPassword = typeof body?.confirmPassword === 'string' ? body.confirmPassword : password
  const validationError = validateNewPassword(password, confirmPassword)
  if (!currentPassword) return NextResponse.json({ message: '请输入当前密码' }, { status: 400, headers: noStoreHeaders })
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400, headers: noStoreHeaders })

  try {
    const user = await prisma.user.findUnique({ where: { id: guard.user.id }, select: { id: true, passwordHash: true } })
    if (!user) return NextResponse.json({ message: '当前登录状态无效，请重新登录' }, { status: 401, headers: noStoreHeaders })
    const currentResult = await verifyPassword(currentPassword, user.passwordHash)
    if (!currentResult.valid) return NextResponse.json({ message: '当前密码不正确' }, { status: 400, headers: noStoreHeaders })
    const samePassword = await verifyPassword(password, user.passwordHash)
    if (samePassword.valid) return NextResponse.json({ message: '新密码不能与当前密码相同' }, { status: 400, headers: noStoreHeaders })

    const passwordHash = await bcrypt.hash(password, 12)
    await prisma.$transaction((tx) => commitPasswordChange(tx, {
      userId: user.id,
      expectedPasswordHash: user.passwordHash,
      passwordHash,
      action: 'PASSWORD_CHANGED_WITH_CURRENT_PASSWORD',
      method: 'CURRENT_PASSWORD',
      ipAddress: ip,
      userAgent: request.headers.get('user-agent')?.slice(0, 500) || null,
    }), { timeout: 15_000, maxWait: 5_000 })
  } catch (error) {
    if (error instanceof PasswordChangeConflictError) return NextResponse.json({ message: '密码状态已变化，请重新登录后再试' }, { status: 409, headers: noStoreHeaders })
    return NextResponse.json({ message: '暂时无法安全修改密码，请稍后重试' }, { status: 503, headers: noStoreHeaders })
  }
  await safeNotificationWrite(
    () => createNotification({ data: { recipientId: guard.user.id, type: 'SYSTEM', title: '密码修改成功', content: '您的登录密码已通过原密码验证完成修改。如非本人操作，请及时联系管理员。', link: '/settings/security' } }),
    { operation: 'password-changed', userId: guard.user.id, notificationType: 'SYSTEM' },
  )
  emitRealtime(guard.user.id, 'notification')
  invalidateCurrentUserCache(guard.user.id)
  return NextResponse.json({ message: '密码修改成功，请使用新密码重新登录' }, { headers: noStoreHeaders })
}
