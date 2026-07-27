'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import { BackToTopButton } from '@/components/BackToTopButton'
import { FriendDock } from '@/components/FriendDock'
import { IcpRecord } from '@/components/IcpRecord'
import type { SessionUser } from '@/lib/auth'
import type { AppShellGrowth } from '@/components/UserProfileSummary'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const shelllessPrefixes = ['/login', '/register', '/forgot-password', '/welcome', '/admin']

export function AppShell({ children, user, growth, logoUrl, unreadCount, canManageLayout, canAccessAdmin }: Readonly<{ children: ReactNode; user: SessionUser | null; growth: AppShellGrowth; logoUrl: string | null; unreadCount: number; canManageLayout: boolean; canAccessAdmin: boolean }>) {
  const pathname = usePathname()
  const [currentUnreadCount, setCurrentUnreadCount] = useState(unreadCount)

  useEffect(() => setCurrentUnreadCount(unreadCount), [unreadCount])

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    const refreshUnreadCount = () => fetch('/api/notifications/unread-count', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<{ count?: number }> : null)
      .then((data) => {
        if (typeof data?.count === 'number') setCurrentUnreadCount(data.count)
      })
      .catch(() => null)
    const onRefresh = () => void refreshUnreadCount()
    window.addEventListener('unread-summary:refresh', onRefresh)
    const timer = window.setInterval(refreshUnreadCount, 30_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('unread-summary:refresh', onRefresh)
    }
  }, [user])

  if (!user || shelllessPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return children

  return <div className="app-shell">
    <Sidebar user={user} growth={growth} logoUrl={logoUrl} unreadCount={currentUnreadCount} canAccessAdmin={canAccessAdmin} />
    <div className="app-main-area">
      <Topbar user={user} logoUrl={logoUrl} unreadCount={currentUnreadCount} canManageLayout={canManageLayout} canAccessAdmin={canAccessAdmin} />
      <div className="app-page-content">{children}</div>
      <footer className="site-footer-info"><IcpRecord /></footer>
      <AdminLayoutQuickLink enabled={canManageLayout} />
    </div>
    <MobileNavigation unreadCount={currentUnreadCount} />
    <BackToTopButton />
    <FriendDock currentUserId={user.id} />
  </div>
}
