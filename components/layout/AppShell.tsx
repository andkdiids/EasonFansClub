'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AdminLayoutQuickLink } from '@/components/AdminLayoutQuickLink'
import { BackToTopButton } from '@/components/BackToTopButton'
import { FriendDock } from '@/components/FriendDock'
import { IcpRecord } from '@/components/IcpRecord'
import type { SessionUser } from '@/lib/auth'
import type { AppShellGrowth } from '@/components/UserProfileSummary'
import { MobileNavigation } from './MobileNavigation'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import type { UnreadSummary } from '@/lib/notifications'

const shelllessPrefixes = ['/login', '/register', '/forgot-password', '/welcome', '/admin']

export function AppShell({ children, user, growth, logoUrl, unreadSummary, canManageLayout, canAccessAdmin }: Readonly<{ children: ReactNode; user: SessionUser | null; growth: AppShellGrowth; logoUrl: string | null; unreadSummary: UnreadSummary; canManageLayout: boolean; canAccessAdmin: boolean }>) {
  const pathname = usePathname()
  const isMusicRoute = pathname === '/music' || pathname.startsWith('/music/')
  const isImmersiveGameRoute = /^\/games\/[^/]+\/play(?:\/|$)/.test(pathname)
  const [currentUnreadSummary, setCurrentUnreadSummary] = useState(unreadSummary)
  const refreshingRef = useRef(false)
  const currentUnreadCount = currentUnreadSummary.total

  useEffect(() => setCurrentUnreadSummary(unreadSummary), [unreadSummary])

  useEffect(() => {
    if (!user) return
    let controller: AbortController | null = null
    const refreshUnreadCount = async () => {
      if (refreshingRef.current || document.visibilityState === 'hidden') return
      refreshingRef.current = true
      controller = new AbortController()
      const data = await fetch('/api/notifications/unread-summary', {
      cache: 'no-store',
      signal: controller.signal,
    })
        .then((response) => response.ok ? response.json() as Promise<UnreadSummary> : null)
        .catch(() => null)
      refreshingRef.current = false
      if (data && typeof data.total === 'number') setCurrentUnreadSummary(data)
    }
    const onRefresh = () => void refreshUnreadCount()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshUnreadCount()
    }
    const channel = 'BroadcastChannel' in window
      ? new BroadcastChannel(`eason-private-sync:${user.id}`)
      : null
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.userId === user.id) void refreshUnreadCount()
        if (event.data?.userId === user.id && event.data?.type === 'logout') location.reload()
      }
    }
    window.addEventListener('unread-summary:refresh', onRefresh)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = window.setInterval(refreshUnreadCount, 5_000)
    return () => {
      controller?.abort()
      channel?.close()
      window.clearInterval(timer)
      window.removeEventListener('unread-summary:refresh', onRefresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user])

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
