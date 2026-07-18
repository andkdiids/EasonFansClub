import { NextResponse } from 'next/server'
import { normalizeAdminUid } from '@/lib/admin-user-advanced'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireSuperAdmin } from '@/lib/security'
import { formatUid } from '@/lib/uid'

type RouteContext = { params: Promise<{ userId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireSuperAdmin()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const normalized = normalizeAdminUid(body?.uid)
  if (!normalized) return NextResponse.json({ message: 'UID 必须是 1 至 5 位数字，且不能为 00000' }, { status: 400 })
  const { userId } = await context.params

  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true, uid: true, nickname: true } })
      if (!target) throw new Error('USER_NOT_FOUND')
      const conflict = await tx.user.findUnique({ where: { uid: normalized.uid }, select: { id: true } })
      if (conflict && conflict.id !== target.id) throw new Error('UID_ALREADY_EXISTS')
      if (target.uid === normalized.uid) return { user: target, changed: false }

      const user = await tx.user.update({ where: { id: userId }, data: { uid: normalized.uid }, select: { id: true, uid: true, nickname: true } })
      await tx.adminActionLog.create({
        data: {
          adminId: guard.user.id,
          targetUserId: userId,
          action: 'UPDATE_USER_UID',
          detail: { previousUid: formatUid(target.uid), newUid: normalized.formattedUid },
        },
      })
      return { user, changed: true }
    })

    if (result.changed) invalidateCurrentUserCache(userId)
    return NextResponse.json({
      user: { ...result.user, formattedUid: formatUid(result.user.uid) },
      message: result.changed ? `UID 已修改为 ${formatUid(result.user.uid)}` : 'UID 未发生变化',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'USER_NOT_FOUND') return NextResponse.json({ message: '用户不存在' }, { status: 404 })
    if (message === 'UID_ALREADY_EXISTS' || (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002')) {
      return NextResponse.json({ message: '该 UID 已被其他用户使用' }, { status: 409 })
    }
    throw error
  }
}
