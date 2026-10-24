import { NextResponse } from 'next/server'
import { validateNewPassword } from '@/lib/account-password'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { hashPassword } from '@/lib/password'
import { logPasswordRecoveryError } from '@/lib/password-recovery-errors'
import { PasswordChangeConflictError, commitPasswordChange } from '@/lib/password-security-transaction'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { getClientIp, rejectInvalidRequestOrigin, requireSuperAdmin } from '@/lib/security'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { upsertNotification } from '@/lib/notification-write'

type RouteContext = { params: Promise<{ userId: string }> }
const securitySetupNotificationKey = 'security-setup-required-after-admin-reset'

function logAdminPasswordResetFailure(stage: string, error: unknown) {
  try {
    logPasswordRecoveryError('admin-password-reset', error, { stage })
  } catch {
    // Logging must never change the result of a committed password operation.
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireSuperAdmin()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const validationError = validateNewPassword(body?.password, body?.confirmPassword)
  if (validationError) return NextResponse.json({ message: validationError }, { status: 400 })
  const { userId } = await context.params
  if (userId === guard.user.id) {
    return NextResponse.json({ message: '不能通过此操作重置自己的密码' }, { status: 400 })
  }

  const ip = getClientIp(request)
  let failureStage = 'PASSWORD_HASH'
  let user: { id: string; uid: number; nickname: string | null; mustSetupSecurity: boolean } | null = null

  try {
    const passwordHash = await hashPassword(body.password)
    failureStage = 'TARGET_LOOKUP'
    user = await prisma.$transaction(async (tx) => {
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
        onStage: (stage) => { failureStage = stage },
      })
      failureStage = 'ADMIN_ACTION_AUDIT'
      await tx.adminActionLog.create({
        data: {
          adminId: guard.user.id,
          targetUserId: userId,
          action: 'RESET_USER_PASSWORD',
          detail: { mustSetupSecurity: true },
        },
      })
      failureStage = 'TRANSACTION_COMMIT'
      return { id: target.id, uid: target.uid, nickname: target.nickname, mustSetupSecurity: true }
    }, { timeout: 15_000, maxWait: 5_000 })
  } catch (error) {
    if (error instanceof Error && error.message === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
    if (error instanceof PasswordChangeConflictError) return NextResponse.json({ message: '该账号状态已变化，请重新查询后重试' }, { status: 409 })
    logAdminPasswordResetFailure(failureStage, error)
    return NextResponse.json({ message: '暂时无法安全重置密码，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  if (!user) {
    logAdminPasswordResetFailure('TRANSACTION_RESULT', new Error('Admin password reset transaction returned no user'))
    return NextResponse.json({ message: '暂时无法安全重置密码，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  // Notifications and realtime delivery are post-commit best-effort effects.
  // They must not make a completed password/session transaction look failed.
  try {
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
  } catch (error) {
    logAdminPasswordResetFailure('POST_COMMIT_NOTIFICATION', error)
  }

  try {
    invalidateCurrentUserCache(userId)
  } catch (error) {
    logAdminPasswordResetFailure('POST_COMMIT_CACHE_INVALIDATION', error)
  }

  try {
    emitRealtime(userId, 'notification')
  } catch (error) {
    logAdminPasswordResetFailure('POST_COMMIT_REALTIME', error)
  }

  return NextResponse.json({ user, message: '密码已重置，用户登录后需要重新设置密保问题' })
}
