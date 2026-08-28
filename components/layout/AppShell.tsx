'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import { BackToTopButton } from '@/components/BackToTopButton'
import { FriendDock } from '@/components/FriendDock'
import { IcpRecord } from '@/components/IcpRecord'
import { useNotificationSummary } from '@/components/NotificationProvider'
import type { SessionShellUser } from '@/lib/auth'
import type { EcenterFeatureItem } from '@/lib/ecenter-features'
import type { AppShellGrowth } from '@/components/UserProfileSummary'
import { DesktopImmersiveToggle } from './DesktopImmersiveToggle'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

// 登录/注册/欢迎等独立页面不需要社区外壳；/admin 现统一复用前台 AppShell（Topbar+Sidebar+MobileNavigation）。
const shelllessPrefixes = ['/login', '/register', '/forgot-password', '/welcome']
const immersiveRoutePrefixes = ['/games', '/entertainment']

function isImmersiveRoute(pathname: string) {
  return immersiveRoutePrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function AppShell({ children, user, growth, logoUrl, canManageLayout, canAccessAdmin, ecenterFeatures }: Readonly<{ children: ReactNode; user: SessionShellUser | null; growth: AppShellGrowth; logoUrl: string | null; canManageLayout: boolean; canAccessAdmin: boolean; ecenterFeatures: readonly EcenterFeatureItem[] }>) {
  const pathname = usePathname()
  const isMusicRoute = pathname === '/music' || pathname.startsWith('/music/')
  const isImmersiveGameRoute = /^\/games\/[^/]+\/play(?:\/|$)/.test(pathname) || pathname === '/games/guess-song/duel' || pathname.startsWith('/games/guess-song/duel/')
  const isEntertainmentRoute = isImmersiveRoute(pathname)
  const [sidebarState, setSidebarState] = useState(() => ({ pathname, collapsed: isEntertainmentRoute }))
  const sidebarCollapsed = sidebarState.pathname === pathname ? sidebarState.collapsed : isEntertainmentRoute
  const { summary: currentUnreadSummary, summaryAvailable } = useNotificationSummary()
  const currentUnreadCount = summaryAvailable ? currentUnreadSummary.total : null

  useEffect(() => {
    setSidebarState({ pathname, collapsed: isEntertainmentRoute })
  }, [isEntertainmentRoute, pathname])

  if (!user || isImmersiveGameRoute || shelllessPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return children

  return <div
    className="app-shell"
    data-music-route={isMusicRoute || undefined}
    data-desktop-immersive={isEntertainmentRoute ? 'true' : undefined}
    data-sidebar-collapsed={isEntertainmentRoute && sidebarCollapsed ? 'true' : undefined}
  >
    <Sidebar user={user} growth={growth} logoUrl={logoUrl} unreadCount={currentUnreadCount} canAccessAdmin={canAccessAdmin} ecenterFeatures={ecenterFeatures} />
    <div className="app-main-area">
      <Topbar user={user} logoUrl={logoUrl} unreadCount={currentUnreadCount} canManageLayout={canManageLayout} canAccessAdmin={canAccessAdmin} />
      <div className="app-page-content">{children}</div>
      <footer className="site-footer-info"><IcpRecord /></footer>
      <AdminLayoutQuickLink enabled={canManageLayout} />
    </div>
    <MobileNavigation unreadCount={currentUnreadCount} canAccessAdmin={canAccessAdmin} ecenterFeatures={ecenterFeatures} />
    <BackToTopButton />
    <FriendDock currentUserId={user.id} unreadSummary={currentUnreadSummary} unreadSummaryAvailable={summaryAvailable} />
    <DesktopImmersiveToggle
      visible={isEntertainmentRoute}
      collapsed={sidebarCollapsed}
      onToggle={() => setSidebarState({ pathname, collapsed: !sidebarCollapsed })}
    />
  </div>
}
