import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { invalidateCurrentUserCache } from '@/lib/auth'
import { adminPermissionGroups, allAdminPermissionKeys, invalidateAdminPermissionCache, type AdminPermissionKey } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { USER_REWARD_PERMISSION } from '@/lib/user-reward-constants'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

const MAX_SEARCH_PAGE_SIZE = 30

/**
 * Native-safe administrator lookup. An empty query deliberately does not
 * touch the database, and the response omits contact and credential fields.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin('admin_manage', request)
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  if (params.get('view') === 'permission-options') {
    const actor = await prisma.user.findUnique({
      where: { id: guard.user.id },
      select: { role: true, status: true, isDeleted: true, AdminPermission: { where: { enabled: true }, select: { permissionKey: true } } },
    })
    const keys = actor?.AdminPermission.map(row => row.permissionKey) ?? []
    const superAdmin = actor?.role === 'SUPER_ADMIN'
    if (!actor || actor.status !== 'ACTIVE' || actor.isDeleted || (!superAdmin && (actor.role !== 'ADMIN' || !keys.includes('admin_manage')))) {
      return NextResponse.json({ message: '当前账号没有管理员管理权限' }, { status: 403 })
    }
    return NextResponse.json({
      options: adminPermissionGroups.filter(item => superAdmin || (keys.includes(item.key) && item.key !== USER_REWARD_PERMISSION))
        .map(({ key, label }) => ({ key, label })),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
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

  const body = await request.json().catch(() => null)
  const userId = String(body?.userId || '')
  if (userId === currentUser.id) return NextResponse.json({ message: '不能修改自己的管理员权限' }, { status: 403 })
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
      updatedAt: true,
      AdminPermission: {
        where: { enabled: true },
        select: { permissionKey: true, enabled: true },
      },
    },
  })
  if (!target) return NextResponse.json({ message: '用户不存在或状态不可用' }, { status: 404 })
  if (target.role === 'SUPER_ADMIN') return NextResponse.json({ message: '不能修改超级管理员权限' }, { status: 400 })
  if (currentUser.role !== 'SUPER_ADMIN') {
    const actor = await prisma.user.findFirst({
      where: { id: currentUser.id, role: 'ADMIN', status: 'ACTIVE', isDeleted: false },
      select: { AdminPermission: { where: { enabled: true }, select: { permissionKey: true } } },
    })
    const allowed = new Set(actor?.AdminPermission.map(row => row.permissionKey))
    if (!allowed.has('admin_manage') || permissions.some(key => !allowed.has(key))
      || target.AdminPermission.some(row => !allowed.has(row.permissionKey))
      || (requestedFullMusic !== undefined && requestedFullMusic !== target.canPlayFullMusic)) {
      return NextResponse.json({ message: '不能修改超出自身权限范围的管理员设置' }, { status: 403 })
    }
    const currentlyEnabled = target.AdminPermission.some((permission) => permission.permissionKey === USER_REWARD_PERMISSION)
    const requestedEnabled = permissions.includes(USER_REWARD_PERMISSION)
    if (currentlyEnabled !== requestedEnabled) {
      return NextResponse.json({ message: '只有超级管理员可以调整用户奖励权限' }, { status: 403 })
    }
  }
  const canPlayFullMusic = requestedFullMusic ?? target.canPlayFullMusic

  const saved = await prisma.$transaction(async (tx) => {
    const changed = await tx.user.updateMany({
      where: { id: target.id, updatedAt: target.updatedAt, role: target.role, status: 'ACTIVE', isDeleted: false },
      data: { role: 'ADMIN', canPlayFullMusic, updatedAt: new Date(Math.max(Date.now(), target.updatedAt.getTime() + 1)) },
    })
    if (changed.count !== 1) return false
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
    return true
  })
  if (!saved) return NextResponse.json({ message: '管理员状态已更新，请刷新后重试' }, { status: 409 })

  invalidateCurrentUserCache(target.id)
  invalidateAdminPermissionCache(target.id)

  return NextResponse.json({ message: '管理员权限已保存' })
}
