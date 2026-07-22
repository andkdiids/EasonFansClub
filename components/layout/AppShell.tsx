'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import type { SessionUser } from '@/lib/auth'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'

const shelllessPrefixes = ['/login', '/register', '/forgot-password', '/welcome', '/admin']

export function AppShell({ children, user, logoUrl, unreadCount, canManageLayout }: Readonly<{ children: ReactNode; user: SessionUser | null; logoUrl: string | null; unreadCount: number; canManageLayout: boolean }>) {
  const pathname = usePathname()
  if (!user || shelllessPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return children

  return <div className="app-shell">
    <Sidebar user={user} logoUrl={logoUrl} unreadCount={unreadCount} />
    <div className="app-main-area">
      <Topbar user={user} logoUrl={logoUrl} unreadCount={unreadCount} />
      <div className="app-page-content">{children}</div>
      <MobileNavigation unreadCount={unreadCount} />
      <AdminLayoutQuickLink enabled={canManageLayout} />
    </div>
  </div>
}
