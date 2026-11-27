import { NextResponse } from 'next/server'
import { invalidateAdminPermissionCache } from '@/lib/admin-permissions'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { USER_REWARD_PERMISSION } from '@/lib/user-reward-constants'

type RouteContext = { params: Promise<{ userId: string }> }

export async function DELETE(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('admin_manage', request)
  if (!guard.user) return guard.response
  const currentUser = guard.user
  const limited = await enforceApiRateLimit(request, currentUser.id, {
    ip: { limit: 60, windowSeconds: 60 * 60 },
    user: { limit: 30, windowSeconds: 60 * 60 },
    endpoint: '/api/admin/admins',
  }, '管理员权限操作过于频繁，请稍后再试')
  if (limited) return limited

  const { userId } = await context.params
  if (userId === currentUser.id) return NextResponse.json({ message: '不能移除自己的管理员身份' }, { status: 403 })
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false },
    select: { id: true, role: true, updatedAt: true, AdminPermission: { where: { enabled: true }, select: { permissionKey: true } } },
  })
  if (!target) return NextResponse.json({ message: '用户不存在或状态不可用' }, { status: 404 })
  if (target.role === 'SUPER_ADMIN') return NextResponse.json({ message: '不能移除超级管理员' }, { status: 400 })
  if (target.role !== 'ADMIN') return NextResponse.json({ message: '目标账号已不是管理员，请刷新' }, { status: 409 })
  if (currentUser.role !== 'SUPER_ADMIN') {
    const actor = await prisma.user.findFirst({
      where: { id: currentUser.id, role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
      select: { AdminPermission: { where: { enabled: true }, select: { permissionKey: true } } },
    })
    const allowed = new Set(actor?.AdminPermission.map(row => row.permissionKey))
    if (!allowed.has('admin_manage') || target.AdminPermission.some(row =>
      row.permissionKey === USER_REWARD_PERMISSION || !allowed.has(row.permissionKey))) {
      return NextResponse.json({ message: '不能移除超出自身权限范围的管理员' }, { status: 403 })
    }
  }

  const saved = await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: target.id, updatedAt: target.updatedAt, role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
      data: { role: 'USER', canPlayFullMusic: false },
    })
    if (changed.count !== 1) return false
    await tx.adminPermission.deleteMany({ where: { userId: target.id } })
    await tx.adminAction.create({
      data: {
        adminId: currentUser.id,
        targetUserId: target.id,
        action: 'UPDATE_USER_ROLE',
        reason: '取消管理员身份',
        metadata: { role: 'USER' },
      },
    })
    return true
  })
  if (!saved) return NextResponse.json({ message: '管理员状态已更新，请刷新后重试' }, { status: 409 })

  invalidateAdminPermissionCache(target.id)
  invalidateCurrentUserCache(target.id)

  return NextResponse.json({ message: '管理员身份已取消' })
}
