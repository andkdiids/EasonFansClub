import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'

type RouteContext = { params: Promise<{ userId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  if (!(await hasAdminPermission(currentUser, 'admin_manage'))) {
    return NextResponse.json({ message: '无权限访问' }, { status: 403 })
  }

  const { userId } = await context.params
  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false },
    select: { id: true, role: true },
  })
  if (!target) return NextResponse.json({ message: '用户不存在或状态不可用' }, { status: 404 })
  if (target.role === 'SUPER_ADMIN') return NextResponse.json({ message: '不能移除超级管理员' }, { status: 400 })

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { role: 'USER' } })
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

  return NextResponse.json({ message: '管理员身份已取消' })
}
