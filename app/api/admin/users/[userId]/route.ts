import { NextResponse } from 'next/server'
import type { UserRole, UserStatus } from '@prisma/client'
import { deleteUserPermanently, getUserDeletionPreview } from '@/lib/admin-user-deletion'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

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
    status?: UserStatus
    level?: number
    exp?: number
    points?: number
    isDeleted?: boolean
    deletedAt?: Date | null
    nicknameChangedAt?: Date | null
  } = {}

  if (body?.role) data.role = body.role
  if (body?.level !== undefined) data.level = Number(body.level)
  if (body?.exp !== undefined) data.exp = Number(body.exp)
  if (body?.points !== undefined) data.points = Number(body.points)

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
        metadata: { action, data },
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
