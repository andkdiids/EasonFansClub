import type { SessionUser } from '@/lib/auth'
import {
  adminModulePermissions,
  adminPermissionGroups,
  allAdminPermissionKeys,
  type AdminPermissionKey,
} from '@/lib/admin-permission-config'
import { prisma } from '@/lib/prisma'

export { adminModulePermissions, adminPermissionGroups, allAdminPermissionKeys, type AdminPermissionKey }

const permissionCacheTtlMs = Number(process.env.ADMIN_PERMISSION_CACHE_TTL_MS || 10000)
const permissionSetCache = new Map<string, { expiresAt: number; permissions: Set<AdminPermissionKey>; promise?: Promise<Set<AdminPermissionKey>> }>()

export function invalidateAdminPermissionCache(userId: string) {
  permissionSetCache.delete(userId)
}

export function isSuperAdmin(user?: Pick<SessionUser, 'role'> | null) {
  return user?.role === 'SUPER_ADMIN'
}

export function isAdminUser(user?: Pick<SessionUser, 'role'> | null) {
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
}

/**
 * 帖子作者是否为「拥有管理权限的角色」（ADMIN / MODERATOR / SUPER_ADMIN）。
 * 用于「加精权限」限制：普通管理员/版主不能给这类作者发布的帖子加精，
 * 仅 SUPER_ADMIN 可以。注意 MODERATOR 也属于受保护对象。
 */
export function isPrivilegedPostAuthor(role?: string | null) {
  return role === 'ADMIN' || role === 'MODERATOR' || role === 'SUPER_ADMIN'
}

export async function getAdminPermissionSet(user: Pick<SessionUser, 'id' | 'role'>) {
  if (isSuperAdmin(user)) return new Set<AdminPermissionKey>(allAdminPermissionKeys)

  const now = Date.now()
  const cached = permissionSetCache.get(user.id)
  if (cached && cached.expiresAt > now) {
    if (cached.promise) return cached.promise
    return new Set(cached.permissions)
  }

  const promise = prisma.adminPermission.findMany({
    where: { userId: user.id, enabled: true },
    select: { permissionKey: true },
  }).then((rows) => {
    return new Set(rows.map((row) => row.permissionKey as AdminPermissionKey).filter((key) => allAdminPermissionKeys.includes(key)))
  }).catch((error) => {
    permissionSetCache.delete(user.id)
    throw error
  })

  permissionSetCache.set(user.id, { expiresAt: now + permissionCacheTtlMs, permissions: new Set(), promise })
  const permissions = await promise
  permissionSetCache.set(user.id, { expiresAt: Date.now() + permissionCacheTtlMs, permissions })
  return new Set(permissions)
}

export async function hasAdminPermission(user: Pick<SessionUser, 'id' | 'role'>, permissionKey?: AdminPermissionKey) {
  if (isSuperAdmin(user)) return true

  const permissions = await getAdminPermissionSet(user)
  return permissionKey ? permissions.has(permissionKey) : permissions.size > 0
}
