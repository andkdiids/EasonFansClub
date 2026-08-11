import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import type { UserRole, UserStatus } from '@prisma/client'
import { deleteUserPermanently, getUserDeletionPreview } from '@/lib/admin-user-deletion'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { isValidEmail, normalizeEmail } from '@/lib/email-verification'
import { prisma } from '@/lib/prisma'
import { adjustRegistrationFeeBalance } from '@/lib/registration-fee'
import { requireAdmin, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

function maskEmail(value: string | null) {
  if (!value) return null
  const [localPart, domain] = value.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart.slice(0, 1)}***@${domain}`
}

async function requireUserDeletionPermission() {
  const guard = await requireAdmin()
  if (!guard.user) return guard

  const canDelete = (await hasAdminPermission(guard.user, 'user_delete')) || (await hasAdminPermission(guard.user, 'user_manage'))
  if (!canDelete) {
    return {
      user: null,
      response: NextResponse.json({ message: '当前管理员未获得永久删除用户权限' }, { status: 403 }),
    }
  }

  return guard
}

function deletionErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const messages: Record<string, string> = {
    USER_NOT_FOUND: '用户不存在',
    UID_CONFIRM_MISMATCH: 'UID 确认不匹配',
    ADMIN_NOT_FOUND: '管理员身份无效',
    SELF_DELETE_REQUIRES_CONFIRMATION: '删除自己的账号需要额外确认',
    LAST_SUPER_ADMIN: '不能删除最后一个超级管理员',
  }

  return NextResponse.json({ message: messages[message] || '删除失败，请稍后重试' }, { status: message === 'USER_NOT_FOUND' ? 404 : 400 })
}

export async function GET(_request: Request, context: RouteContext) {
  const guard = await requireUserDeletionPermission()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const preview = await getUserDeletionPreview(userId)
  if (!preview) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  return NextResponse.json({ preview })
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('user_manage')
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const body = await request.json().catch(() => null)
  const action = sanitizeText(body?.action, 40)

  if (action === 'updateEmail') {
    const email = normalizeEmail(sanitizeText(body?.email, 320))
    if (!email || email.length > 254 || !isValidEmail(email)) {
      return NextResponse.json({ message: '请输入有效邮箱地址' }, { status: 400 })
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true, email: true, emailVerifiedAt: true },
        })
        if (!target) throw new Error('USER_NOT_FOUND')
        if (target.email === email) {
          return { changed: false, user: { id: target.id, email: target.email, emailVerifiedAt: target.emailVerifiedAt } }
        }

        const conflict = await tx.user.findFirst({
          where: { email, isDeleted: false, NOT: { id: userId } },
          select: { id: true },
        })
        if (conflict) throw new Error('EMAIL_ALREADY_EXISTS')

        const user = await tx.user.update({
          where: { id: userId },
          data: { email, emailVerifiedAt: null },
          select: { id: true, email: true, emailVerifiedAt: true },
        })

        await tx.adminActionLog.create({
          data: {
            adminId: guard.user.id,
            targetUserId: userId,
            action: 'UPDATE_USER_EMAIL',
            detail: {
              previousEmail: maskEmail(target.email),
              newEmail: maskEmail(user.email),
              reason: sanitizeText(body?.reason, 180) || null,
            },
          },
        })

        return { changed: true, user }
      })

      invalidateCurrentUserCache(userId)
      return NextResponse.json({
        user: result.user,
        message: result.changed ? '绑定邮箱已修改' : '绑定邮箱未发生变化',
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (code === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
      if (code === 'EMAIL_ALREADY_EXISTS' || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        return NextResponse.json({ message: '该邮箱已被其他用户绑定' }, { status: 409 })
      }
      throw error
    }
  }

  if (action === 'delete') {
    const deleteGuard = await requireUserDeletionPermission()
    if (!deleteGuard.user) return deleteGuard.response

    try {
      const result = await deleteUserPermanently({
        adminId: deleteGuard.user.id,
        userId,
        confirmUid: sanitizeText(body?.confirmUid, 16),
        deletePublicContent: Boolean(body?.deletePublicContent),
        confirmSelf: Boolean(body?.confirmSelf),
      })
      return NextResponse.json(result)
    } catch (error) {
      return deletionErrorResponse(error)
    }
  }

  const data: {
    role?: UserRole
    canPlayFullMusic?: boolean
    status?: UserStatus
    level?: number
    isDeleted?: boolean
    deletedAt?: Date | null
    nicknameChangedAt?: Date | null
  } = {}

  if (body?.role) {
    data.role = body.role
    if (body.role !== 'ADMIN' && body.role !== 'SUPER_ADMIN') data.canPlayFullMusic = false
  }
  if (body?.level !== undefined) data.level = Number(body.level)
  if (body?.exp !== undefined || body?.experience !== undefined || body?.experiencePoints !== undefined) {
    return NextResponse.json({ message: '经验值只能通过每日挂号或精华帖子奖励增加' }, { status: 400 })
  }
  const targetPoints = body?.points === undefined ? undefined : Number(body.points)
  if (targetPoints !== undefined && (!Number.isSafeInteger(targetPoints) || targetPoints < 0)) {
    return NextResponse.json({ message: '挂号费余额必须是非负整数' }, { status: 400 })
  }

  if (action === 'ban') {
    data.status = 'BANNED'
  } else if (action === 'unban') {
    data.status = 'ACTIVE'
    data.isDeleted = false
    data.deletedAt = null
  } else if (action === 'merge') {
    data.status = 'MERGED'
  } else if (action === 'disable') {
    data.status = 'DISABLED'
  } else if (action === 'resetNicknameCooldown') {
    data.nicknameChangedAt = null
  } else if (body?.status === 'DELETED') {
    return NextResponse.json({ message: '删除用户请使用永久删除确认流程' }, { status: 400 })
  } else if (body?.status) {
    data.status = body.status
  }

  const user = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { id: userId },
      select: { phone: true },
    })

    if (!existing) {
      throw new Error('USER_NOT_FOUND')
    }

    if (targetPoints !== undefined) {
      await adjustRegistrationFeeBalance(tx, {
        userId,
        targetPoints,
        reason: sanitizeText(body?.reason, 180) || '管理员调整挂号费',
        businessKey: sanitizeText(body?.idempotencyKey, 120) || undefined,
      })
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        uid: true,
        nickname: true,
        role: true,
        status: true,
        level: true,
        exp: true,
        points: true,
        isDeleted: true,
      },
    })

    if (data.status === 'DELETED') {
      if (existing.phone) {
        await tx.smsCode.updateMany({
          where: { phone: existing.phone, usedAt: null },
          data: { usedAt: new Date() },
        })
      }
      await tx.onlineSession.deleteMany({ where: { userId } })
    }

    await tx.adminAction.create({
      data: {
        adminId: guard.user.id,
        targetUserId: userId,
        action: data.status === 'DELETED' ? 'DELETE_USER' : data.status === 'BANNED' ? 'BAN_USER' : 'UPDATE_USER_POINTS',
        reason: sanitizeText(body?.reason, 180) || '管理员更新用户状态',
        metadata: { action, data, ...(targetPoints !== undefined ? { targetPoints } : {}) },
      },
    })

    return updated
  })

  return NextResponse.json({ user })
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireUserDeletionPermission()
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const body = await request.json().catch(() => null)

  try {
    const result = await deleteUserPermanently({
      adminId: guard.user.id,
      userId,
      confirmUid: sanitizeText(body?.confirmUid, 16),
      deletePublicContent: Boolean(body?.deletePublicContent),
      confirmSelf: Boolean(body?.confirmSelf),
    })
    return NextResponse.json(result)
  } catch (error) {
    return deletionErrorResponse(error)
  }
}
