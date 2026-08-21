import { NextResponse } from 'next/server'
import { invalidateAdminPermissionCache } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireAdmin } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireAdmin('admin_manage')
  if (!guard.user) return guard.response
  const currentUser = guard.user
  const limited = await enforceApiRateLimit(request, currentUser.id, {
    ip: { limit: 60, windowSeconds: 60 * 60 },
    user: { limit: 30, windowSeconds: 60 * 60 },
    endpoint: '/api/admin/admins',
  }, '管理员权限操作过于频繁，请稍后再试')
  if (limited) return limited

  const { userId } = await context.params
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false },
    select: { id: true, role: true },
  })
  if (!target) return NextResponse.json({ message: '用户不存在或状态不可用' }, { status: 404 })
  if (target.role === 'SUPER_ADMIN') return NextResponse.json({ message: '不能移除超级管理员' }, { status: 400 })

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { role: 'USER', canPlayFullMusic: false } })
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
  })

  invalidateAdminPermissionCache(target.id)

  return NextResponse.json({ message: '管理员身份已取消' })
}
