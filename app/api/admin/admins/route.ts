import { NextResponse } from 'next/server'
import { getCurrentUser, invalidateCurrentUserCache } from '@/lib/auth'
import { allAdminPermissionKeys, invalidateAdminPermissionCache, type AdminPermissionKey, hasAdminPermission } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { USER_REWARD_PERMISSION } from '@/lib/user-reward-constants'

export async function POST(request: Request) {
  const currentUser = await getCurrentUser()
  if (!currentUser) return NextResponse.json({ message: '请先登录' }, { status: 401 })
  if (!(await hasAdminPermission(currentUser, 'admin_manage'))) {
    return NextResponse.json({ message: '无权限访问' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const userId = String(body?.userId || '')
  const permissions: AdminPermissionKey[] = Array.isArray(body?.permissions)
    ? body.permissions.filter((key: unknown): key is AdminPermissionKey => typeof key === 'string' && allAdminPermissionKeys.includes(key as AdminPermissionKey))
    : []
  const requestedFullMusic = typeof body?.canPlayFullMusic === 'boolean' ? body.canPlayFullMusic : undefined

  const target = await prisma.user.findFirst({
    where: { id: userId, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    select: {
      id: true,
      role: true,
      uid: true,
      nickname: true,
      canPlayFullMusic: true,
      AdminPermission: {
        where: { permissionKey: USER_REWARD_PERMISSION },
        select: { enabled: true },
      },
    },
  })
  if (!target) return NextResponse.json({ message: '用户不存在或状态不可用' }, { status: 404 })
  if (target.role === 'SUPER_ADMIN') return NextResponse.json({ message: '不能修改超级管理员权限' }, { status: 400 })
  if (currentUser.role !== 'SUPER_ADMIN') {
    const currentlyEnabled = target.AdminPermission.some((permission) => permission.enabled)
    const requestedEnabled = permissions.includes(USER_REWARD_PERMISSION)
    if (currentlyEnabled !== requestedEnabled) {
      return NextResponse.json({ message: '只有超级管理员可以调整用户奖励权限' }, { status: 403 })
    }
  }
  const canPlayFullMusic = requestedFullMusic ?? target.canPlayFullMusic

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: target.id }, data: { role: 'ADMIN', canPlayFullMusic } })
    await tx.adminPermission.deleteMany({ where: { userId: target.id } })
    if (permissions.length) {
      await tx.adminPermission.createMany({
        data: permissions.map((permissionKey) => ({ userId: target.id, permissionKey, enabled: true })),
        skipDuplicates: true,
      })
    }
    await tx.adminAction.create({
      data: {
        adminId: currentUser.id,
        targetUserId: target.id,
        action: 'UPDATE_USER_ROLE',
        reason: '设置管理员权限',
        metadata: { role: 'ADMIN', permissions, canPlayFullMusic },
      },
    })
  })

  invalidateCurrentUserCache(target.id)
  invalidateAdminPermissionCache(target.id)

  return NextResponse.json({ message: '管理员权限已保存' })
}
