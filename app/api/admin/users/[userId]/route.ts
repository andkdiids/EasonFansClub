import { NextResponse } from 'next/server'
import type { UserRole, UserStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('user_manage')
  if (!guard.user) return guard.response

  const { userId } = await context.params
  const body = await request.json().catch(() => null)
  const action = sanitizeText(body?.action, 40)

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

  if (action === 'delete') {
    data.status = 'DELETED'
    data.isDeleted = true
    data.deletedAt = new Date()
  } else if (action === 'ban') {
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
