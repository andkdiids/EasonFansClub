import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { validateAdminResetPassword } from '@/lib/admin-user-advanced'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { rejectInvalidRequestOrigin, requireSuperAdmin } from '@/lib/security'
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

  try {
    const user = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, nickname: true } })
      if (!target) throw new Error('USER_NOT_FOUND')

      const updated = await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustSetupSecurity: true },
        select: { id: true, uid: true, nickname: true, mustSetupSecurity: true },
      })
      await tx.adminActionLog.create({
        data: {
          adminId: guard.user.id,
          targetUserId: userId,
          action: 'RESET_USER_PASSWORD',
          detail: { mustSetupSecurity: true },
        },
      })
      return updated
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
    throw error
  }
}
