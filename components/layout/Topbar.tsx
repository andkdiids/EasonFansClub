'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UiIcon } from '@/components/UiIcon'
import { UserAvatar } from '@/components/UserAvatar'
import type { SessionUser } from '@/lib/auth'
import { isMusicRoute } from '@/lib/navigation'

export function Topbar({ user, logoUrl, unreadCount, canManageLayout, canAccessAdmin }: Readonly<{ user: SessionUser; logoUrl: string | null; unreadCount: number; canManageLayout: boolean; canAccessAdmin: boolean }>) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRootRef = useRef<HTMLDivElement>(null)
  const home = pathname === '/community'
  const inverse = home || isMusicRoute(pathname)

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

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
    if ((await fetch('/api/auth/logout', { method: 'POST' })).ok) location.replace('/login')
  }

  return <header className={`app-topbar ${home ? 'app-topbar-home' : ''} ${inverse ? 'app-topbar-inverse' : ''}`}>
    <Link href="/community" className="app-topbar-brand" aria-label="社区首页"><BrandMark logoUrl={logoUrl} inverse={inverse} compact /></Link>
    <form action="/search" className="app-topbar-search" role="search">
      <UiIcon name="search" />
      <input name="q" aria-label="搜索帖子、歌曲、专辑和用户" placeholder="搜索帖子、歌曲、专辑、用户…" />
    </form>
    <div ref={menuRootRef} className="app-topbar-actions">
      {canManageLayout ? <Link href="/admin/layout-editor" aria-label="布局编辑器"><UiIcon name="edit" /></Link> : null}
      <Link href="/notifications" aria-label={`通知，${unreadCount}条未读`} className="app-topbar-notification"><UiIcon name="bell" />{unreadCount > 0 ? <b>{unreadCount}</b> : null}</Link>
      <ThemeToggle />
      <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="用户菜单">
        <span className="app-topbar-avatar"><UserAvatar user={user} /></span>
        <UiIcon name="menu" />
      </button>
      {menuOpen ? <div className="app-topbar-menu" data-user-menu-panel>
        <Link href="/profile" onClick={() => setMenuOpen(false)}>我的主页</Link>
        <Link href="/notifications" onClick={() => setMenuOpen(false)}>消息中心</Link>
        <Link href="/profile?module=favorites#profile-modules" onClick={() => setMenuOpen(false)}>我的收藏</Link>
        <Link href="/profile#checkin-records" onClick={() => setMenuOpen(false)}>签到记录</Link>
        <Link href="/settings/security" onClick={() => setMenuOpen(false)}>账号安全</Link>
        {canAccessAdmin ? <Link href="/admin" onClick={() => setMenuOpen(false)} className="app-topbar-admin-link">后台管理</Link> : null}
        <button type="button" onClick={logout}>退出登录</button>
      </div> : null}
    </div>
  </header>
}
