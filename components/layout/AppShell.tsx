'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import { BackToTopButton } from '@/components/BackToTopButton'
import { FriendDock } from '@/components/FriendDock'
import { IcpRecord } from '@/components/IcpRecord'
import { useNotificationSummary } from '@/components/NotificationProvider'
import type { SessionUser } from '@/lib/auth'
import type { AppShellGrowth } from '@/components/UserProfileSummary'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const shelllessPrefixes = ['/login', '/register', '/forgot-password', '/welcome', '/admin']

export function AppShell({ children, user, growth, logoUrl, canManageLayout, canAccessAdmin }: Readonly<{ children: ReactNode; user: SessionUser | null; growth: AppShellGrowth; logoUrl: string | null; canManageLayout: boolean; canAccessAdmin: boolean }>) {
  const pathname = usePathname()
  const isMusicRoute = pathname === '/music' || pathname.startsWith('/music/')
  const isImmersiveGameRoute = /^\/games\/[^/]+\/play(?:\/|$)/.test(pathname)
  const { summary: currentUnreadSummary } = useNotificationSummary()
  const currentUnreadCount = currentUnreadSummary.total

  if (!user || isImmersiveGameRoute || shelllessPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return children

  return <div className="app-shell" data-music-route={isMusicRoute || undefined}>
    <Sidebar user={user} growth={growth} logoUrl={logoUrl} unreadCount={currentUnreadCount} canAccessAdmin={canAccessAdmin} />
    <div className="app-main-area">
      <Topbar user={user} logoUrl={logoUrl} unreadCount={currentUnreadCount} canManageLayout={canManageLayout} canAccessAdmin={canAccessAdmin} />
      <div className="app-page-content">{children}</div>
      <footer className="site-footer-info"><IcpRecord /></footer>
      <AdminLayoutQuickLink enabled={canManageLayout} />
    </div>
    <MobileNavigation unreadCount={currentUnreadCount} canAccessAdmin={canAccessAdmin} />
    <BackToTopButton />
    <FriendDock currentUserId={user.id} unreadSummary={currentUnreadSummary} />
  </div>
}
