import type { SessionUser } from '@/lib/auth'
import {
  adminModulePermissions,
  adminPermissionGroups,
  allAdminPermissionKeys,
  type AdminPermissionKey,
} from '@/lib/admin-permission-config'
import { prisma } from '@/lib/prisma'

export { adminModulePermissions, adminPermissionGroups, allAdminPermissionKeys, type AdminPermissionKey }

export function isSuperAdmin(user?: Pick<SessionUser, 'role'> | null) {
  return user?.role === 'SUPER_ADMIN'
}

export function isAdminUser(user?: Pick<SessionUser, 'role'> | null) {
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
}

export async function getAdminPermissionSet(user: Pick<SessionUser, 'id' | 'role'>) {
  if (isSuperAdmin(user)) return new Set<AdminPermissionKey>(allAdminPermissionKeys)
  if (user.role !== 'ADMIN') return new Set<AdminPermissionKey>()

  const rows = await prisma.adminPermission.findMany({
    where: { userId: user.id, enabled: true },
    select: { permissionKey: true },
  })

  return new Set(rows.map((row) => row.permissionKey as AdminPermissionKey).filter((key) => allAdminPermissionKeys.includes(key)))
}

export async function hasAdminPermission(user: Pick<SessionUser, 'id' | 'role'>, permissionKey?: AdminPermissionKey) {
  if (isSuperAdmin(user)) return true
  if (user.role !== 'ADMIN') return false
  if (!permissionKey) return true

  const permission = await prisma.adminPermission.findUnique({
    where: { userId_permissionKey: { userId: user.id, permissionKey } },
    select: { enabled: true },
  })

  return Boolean(permission?.enabled)
}
