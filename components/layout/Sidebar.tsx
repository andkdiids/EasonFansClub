'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BrandMark } from '@/components/BrandMark'
import { IcpRecord } from '@/components/IcpRecord'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UiIcon } from '@/components/UiIcon'
import { UserProfileSummary, type AppShellGrowth } from '@/components/UserProfileSummary'
import type { SessionUser } from '@/lib/auth'
import { isAppNavigationActive, primaryNavigation, quickNavigation } from './navigation'

export function Sidebar({ user, growth, logoUrl, unreadCount, canAccessAdmin }: Readonly<{ user: SessionUser; growth: AppShellGrowth; logoUrl: string | null; unreadCount: number; canAccessAdmin: boolean }>) {
  const pathname = usePathname()

  async function logout() {
    if ((await fetch('/api/auth/logout', { method: 'POST' })).ok) location.replace('/login')
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
    <div className="sidebar-user">
      <UserProfileSummary user={user} growth={growth} />
      <div className="sidebar-actions">
        <Link href="/profile" aria-label="设置"><UiIcon name="settings" /></Link>
        <ThemeToggle />
        <button type="button" onClick={logout} aria-label="退出登录"><UiIcon name="logout" /></button>
      </div>
      <IcpRecord />
    </div>
  </aside>
}
