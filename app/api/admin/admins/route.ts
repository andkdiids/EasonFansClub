import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { allAdminPermissionKeys, invalidateAdminPermissionCache, type AdminPermissionKey } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { USER_REWARD_PERMISSION } from '@/lib/user-reward-constants'
import { enforceApiRateLimit, requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const MAX_SEARCH_PAGE_SIZE = 30

/**
 * Native-safe administrator lookup. An empty query deliberately does not
 * touch the database, and the response omits contact and credential fields.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin('admin_manage')
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  const query = sanitizeText(params.get('q'), 80).trim()
  const rawPage = Number(params.get('page') || 1)
  const rawPageSize = Number(params.get('pageSize') || 20)
  const page = Number.isSafeInteger(rawPage) ? Math.min(10_000, Math.max(1, rawPage)) : 1
  const pageSize = Number.isSafeInteger(rawPageSize) ? Math.min(MAX_SEARCH_PAGE_SIZE, Math.max(1, rawPageSize)) : 20

  if (!query) return NextResponse.json({ admins: [], page, pageSize, hasMore: false, queryRequired: true }, { headers: { 'Cache-Control': 'private, no-store' } })

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/admins:GET',
    ip: { limit: 60, windowSeconds: 60 },
    user: { limit: 30, windowSeconds: 60 },
  })
  if (limited) return limited

  const numericUid = /^\d+$/.test(query) ? Number(query) : null
  const where: Prisma.UserWhereInput = {
    role: { in: ['ADMIN', 'SUPER_ADMIN'] },
    isDeleted: false,
    OR: [
      ...(numericUid !== null && Number.isSafeInteger(numericUid) ? [{ uid: numericUid }] : []),
      { username: { contains: query } },
      { nickname: { contains: query } },
      { Profile: { displayName: { contains: query } } },
    ],
  }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { uid: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize + 1,
      select: {
        id: true,
        uid: true,
        username: true,
        nickname: true,
        role: true,
        status: true,
        createdAt: true,
        Profile: { select: { displayName: true } },
        AdminPermission: { where: { enabled: true }, select: { permissionKey: true } },
      },
    }),
    prisma.user.count({ where }),
  ])
  const hasMore = rows.length > pageSize
  const admins = (hasMore ? rows.slice(0, pageSize) : rows).map(({ AdminPermission, ...admin }) => ({
    ...admin,
    permissions: AdminPermission.map(({ permissionKey }) => permissionKey),
  }))
  return NextResponse.json({ admins, page, pageSize, total, hasMore, queryRequired: false }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('admin_manage')
  if (!guard.user) return guard.response
  const currentUser = guard.user
  const limited = await enforceApiRateLimit(request, currentUser.id, {
    ip: { limit: 60, windowSeconds: 60 * 60 },
    user: { limit: 30, windowSeconds: 60 * 60 },
    endpoint: '/api/admin/admins',
  }, '管理员权限操作过于频繁，请稍后再试')
  if (limited) return limited

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
