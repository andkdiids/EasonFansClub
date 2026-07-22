'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import type { SessionUser } from '@/lib/auth'
import type { AppShellGrowth } from '@/components/UserProfileSummary'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const shelllessPrefixes = ['/login', '/register', '/forgot-password', '/welcome', '/admin']

export function AppShell({ children, user, growth, logoUrl, unreadCount, canManageLayout, canAccessAdmin }: Readonly<{ children: ReactNode; user: SessionUser | null; growth: AppShellGrowth; logoUrl: string | null; unreadCount: number; canManageLayout: boolean; canAccessAdmin: boolean }>) {
  const pathname = usePathname()
  if (!user || shelllessPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return children

  return <div className="app-shell">
    <Sidebar user={user} growth={growth} logoUrl={logoUrl} unreadCount={unreadCount} canAccessAdmin={canAccessAdmin} />
    <div className="app-main-area">
      <Topbar user={user} logoUrl={logoUrl} unreadCount={unreadCount} canManageLayout={canManageLayout} canAccessAdmin={canAccessAdmin} />
      <div className="app-page-content">{children}</div>
      <MobileNavigation unreadCount={unreadCount} />
      <AdminLayoutQuickLink enabled={canManageLayout} />
    </div>
  </div>
}
