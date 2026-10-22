import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { validateAdminResetPassword } from '@/lib/admin-user-advanced'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { PasswordChangeConflictError, commitPasswordChange } from '@/lib/password-security-transaction'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { getClientIp, rejectInvalidRequestOrigin, requireSuperAdmin } from '@/lib/security'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { upsertNotification } from '@/lib/notification-write'

type RouteContext = { params: Promise<{ userId: string }> }
const securitySetupNotificationKey = 'security-setup-required-after-admin-reset'

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireSuperAdmin()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const validationError = validateAdminResetPassword(body?.password, body?.confirmPassword)
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400 })
  const { userId } = await context.params
  const passwordHash = await bcrypt.hash(body.password, 12)
  const ip = getClientIp(request)

  try {
    const user = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, uid: true, nickname: true, passwordHash: true } })
      if (!target) throw new Error('USER_NOT_FOUND')

      await commitPasswordChange(tx, {
        userId,
        expectedPasswordHash: target.passwordHash,
        passwordHash,
        mustSetupSecurity: true,
        action: 'PASSWORD_RESET_BY_ADMIN',
        method: 'ADMIN_RESET',
        ipAddress: ip,
        userAgent: request.headers.get('user-agent')?.slice(0, 500) || null,
      })
      await tx.adminActionLog.create({
        data: {
          adminId: guard.user.id,
          targetUserId: userId,
          action: 'RESET_USER_PASSWORD',
          detail: { mustSetupSecurity: true },
        },
      })
      return { id: target.id, uid: target.uid, nickname: target.nickname, mustSetupSecurity: true }
    }, { timeout: 15_000, maxWait: 5_000 })

    await safeNotificationWrite(
      () => upsertNotification({
        where: { recipientId_key: { recipientId: userId, key: securitySetupNotificationKey } },
        update: {
          title: '密码已由超级管理员重置',
          content: '请使用新密码登录，并重新设置账号密保问题。',
          link: '/settings/security-questions',
          isRead: false,
          readAt: null,
          completedAt: null,
        },
        create: {
          recipientId: userId,
          key: securitySetupNotificationKey,
          type: 'SYSTEM',
          title: '密码已由超级管理员重置',
          content: '请使用新密码登录，并重新设置账号密保问题。',
          link: '/settings/security-questions',
        },
      }),
      { operation: 'admin-password-reset', userId, notificationType: 'SYSTEM' },
    )
    invalidateCurrentUserCache(userId)
    emitRealtime(userId, 'notification')
    return NextResponse.json({ user, message: '密码已重置，用户登录后需要重新设置密保问题' })
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
    if (error instanceof PasswordChangeConflictError) return NextResponse.json({ message: '该账号状态已变化，请重新查询后重试' }, { status: 409 })
    return NextResponse.json({ message: '暂时无法安全重置密码，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
