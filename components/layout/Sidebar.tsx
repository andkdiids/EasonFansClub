'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UiIcon } from '@/components/UiIcon'
import { UserProfileSummary, type AppShellGrowth } from '@/components/UserProfileSummary'
import type { SessionUser } from '@/lib/auth'
import { isAppNavigationActive, primaryNavigation, quickNavigation } from './navigation'

export function Sidebar({ user, growth, logoUrl, unreadCount, canAccessAdmin }: Readonly<{ user: SessionUser; growth: AppShellGrowth; logoUrl: string | null; unreadCount: number; canAccessAdmin: boolean }>) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRootRef = useRef<HTMLDivElement>(null)

  useEffect(() => setMenuOpen(false), [pathname])

  useEffect(() => {
    if (!menuOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  async function logout() {
    if ((await fetch('/api/auth/logout', { method: 'POST' })).ok) {
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel(`eason-private-sync:${user.id}`)
        channel.postMessage({ type: 'logout', userId: user.id })
        channel.close()
      }
      location.replace('/login')
    }
  }

  function navigation(items: typeof primaryNavigation, label: string) {
    return <nav className="sidebar-nav" aria-label={label}>{items.map((item) => {
      const active = isAppNavigationActive(pathname, item)
      return <Link key={`${label}-${item.label}`} href={item.href} aria-current={active ? 'page' : undefined}>
        <UiIcon name={item.icon} />
        <span>{item.label}</span>
        {item.showsUnread && unreadCount > 0 ? <b>{unreadCount}</b> : null}
      </Link>
    })}</nav>
  }

  return <aside className="app-sidebar">
    <Link href="/community" className="sidebar-brand" aria-label="社区首页"><BrandMark logoUrl={logoUrl} compact /></Link>
    <div className="app-sidebar-scroll">
      {navigation(primaryNavigation, '主要导航')}
      <p className="sidebar-section-label">快捷入口</p>
      {navigation(quickNavigation, '快捷入口')}
      {canAccessAdmin ? <nav className="sidebar-nav sidebar-admin-nav" aria-label="管理入口"><Link href="/admin" aria-current={pathname.startsWith('/admin') ? 'page' : undefined}><UiIcon name="settings" /><span>后台管理</span></Link></nav> : null}
    </div>
    <div ref={menuRootRef} className="sidebar-user">
      {menuOpen ? <div className="sidebar-user-menu" role="menu">
        <Link href="/profile" role="menuitem">我的主页</Link>
        <Link href="/notifications" role="menuitem">消息中心</Link>
        <Link href="/profile?module=favorites#profile-modules" role="menuitem">我的收藏</Link>
        <Link href="/games" role="menuitem">娱乐中心</Link>
        <Link href="/settings/security" role="menuitem">账号安全</Link>
        {canAccessAdmin ? <Link href="/admin" role="menuitem" className="sidebar-user-admin">后台管理</Link> : null}
        <button type="button" role="menuitem" onClick={logout}>退出登录</button>
      </div> : null}
      <UserProfileSummary user={user} growth={growth} onActivate={() => setMenuOpen((value) => !value)} />
      <div className="sidebar-actions" aria-label="用户快捷操作">
        <Link href="/notifications" aria-label={`消息通知，${unreadCount}条未读`} className="sidebar-notification-action">
          <UiIcon name="bell" />
          {unreadCount > 0 ? <b>{unreadCount}</b> : null}
        </Link>
        <ThemeToggle />
        <button type="button" onClick={logout} aria-label="退出登录"><UiIcon name="logout" /></button>
      </div>
    </div>
  </aside>
}
