import { NAVIGATION_REGISTRY, type NavigationRegistryItem } from '@/lib/navigation-registry'

export type AppNavigationItem = {
  featureKey: string
  href: string
  label: string
  icon: NavigationRegistryItem['icon']
  activePrefixes?: readonly string[]
  mobile?: boolean
  showsUnread?: boolean
  children?: AppNavigationItem[]
}

export const primaryNavigation: AppNavigationItem[] = NAVIGATION_REGISTRY
  .filter((item) => item.showInDesktopSidebar && item.sidebarSection === 'primary')
  .map((item) => ({
    featureKey: item.featureKey,
    href: item.href,
    label: item.label,
    icon: item.icon,
    activePrefixes: item.activePrefixes,
    mobile: 'mobile' in item ? item.mobile : undefined,
    showsUnread: 'showsUnread' in item ? item.showsUnread : undefined,
  }))

export function isAppNavigationActive(pathname: string, item: AppNavigationItem) {
  if (item.featureKey === 'ENTERTAINMENT' && (pathname === '/games/daily-prescription' || pathname.startsWith('/games/daily-prescription/'))) return false
  const prefixes = item.activePrefixes || [item.href]
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
