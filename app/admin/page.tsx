import { requireAdminPage } from '@/components/AdminAccess'
import { AdminHomeSurface } from '@/components/AdminHomeSurface'
import { adminModulePermissions } from '@/lib/admin-permission-config'
import { getAdminPermissionSet, isSuperAdmin } from '@/lib/admin-permissions'
import { adminNavigationGroups } from '@/lib/admin-navigation'

export const dynamic = 'force-dynamic'


function routeFromHref(href: string) {
  return href.split(/[?#]/, 1)[0]
}

function permissionForRoute(route: string) {
  const exact = adminModulePermissions[route]
  if (exact) return exact

  const parentRoute = Object.keys(adminModulePermissions)
    .filter((candidate) => route.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0]
  return parentRoute ? adminModulePermissions[parentRoute] : undefined
}

export default async function AdminPage() {
  const currentUser = await requireAdminPage('/admin')
  const permissionSet = await getAdminPermissionSet(currentUser)
  const superAdmin = isSuperAdmin(currentUser)
  const canViewRoute = (href: string) => {
    if (superAdmin) return true
    const permission = permissionForRoute(routeFromHref(href))
    return Boolean(permission && permissionSet.has(permission))
  }
  const visibleGroups = adminNavigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => canViewRoute(item.href)) }))
    .filter((group) => group.items.length > 0)
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-5 sm:py-7">
      <AdminHomeSurface groups={visibleGroups} />
    </main>
  )
}
