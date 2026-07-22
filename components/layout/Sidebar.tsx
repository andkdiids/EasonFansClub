'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UiIcon } from '@/components/UiIcon'
import type { SessionUser } from '@/lib/auth'
import { formatUid } from '@/lib/uid'
import { isAppNavigationActive, primaryNavigation, quickNavigation } from './navigation'

type SidebarStats = { level: number; experience: number; nextRequiredExp: number | null; progressPercent: number }

export function Sidebar({ user, logoUrl, unreadCount }: Readonly<{ user: SessionUser; logoUrl: string | null; unreadCount: number }>) {
  const pathname = usePathname()
  const [stats, setStats] = useState<SidebarStats | null>(null)
  const name = user.nickname || user.username

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/home', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => payload?.stats && setStats({
        level: payload.stats.level,
        experience: payload.stats.experience,
        nextRequiredExp: payload.stats.nextRequiredExp,
        progressPercent: payload.stats.progressPercent,
      }))
      .catch(() => undefined)
    return () => controller.abort()
  }, [])

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
    </div>
    <div className="sidebar-user">
      <Link href={`/user/${formatUid(user.uid)}`} className="sidebar-user-row">
        <span className="sidebar-avatar">{user.avatarUrl ? <Image src={user.avatarUrl} alt={`${name}的头像`} fill sizes="34px" className="object-cover" /> : name[0]}</span>
        <span><strong>{name}</strong><small>Lv.{stats?.level ?? '—'}</small></span>
      </Link>
      <div className="sidebar-growth" aria-label="成长经验">
        <div className="sidebar-progress" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, stats?.progressPercent || 0))}%` }} /></div>
        <small>{new Intl.NumberFormat('zh-CN').format(stats?.experience || 0)} / {new Intl.NumberFormat('zh-CN').format(stats?.nextRequiredExp ?? stats?.experience ?? 0)} EXP</small>
      </div>
      <div className="sidebar-actions">
        <Link href="/profile" aria-label="设置"><UiIcon name="settings" /></Link>
        <ThemeToggle />
        <button type="button" onClick={logout} aria-label="退出登录"><UiIcon name="logout" /></button>
      </div>
    </div>
  </aside>
}
