'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UiIcon } from '@/components/UiIcon'
import { UserAvatar } from '@/components/UserAvatar'
import type { SessionShellUser } from '@/lib/auth'
import { isMusicRoute } from '@/lib/navigation'

export function Topbar({ user, logoUrl, canAccessAdmin }: Readonly<{ user: SessionShellUser; logoUrl: string | null; canAccessAdmin: boolean }>) {
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
    if ((await fetch('/api/auth/logout', { method: 'POST' })).ok) {
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel(`eason-private-sync:${user.id}`)
        channel.postMessage({ type: 'logout', userId: user.id })
        channel.close()
      }
      location.replace('/login')
    }
  }

  return <header className={`app-topbar ${home ? 'app-topbar-home' : ''} ${inverse ? 'app-topbar-inverse' : ''}`}>
    <Link href="/community" className="app-topbar-brand" aria-label="社区首页"><BrandMark logoUrl={logoUrl} inverse={inverse} compact /></Link>
    <form action="/search" className="app-topbar-search" role="search">
      <UiIcon name="search" />
      <input name="q" aria-label="搜索帖子、歌曲、专辑和用户" placeholder="搜索帖子、歌曲、专辑、用户…" />
    </form>
    <div ref={menuRootRef} className="app-topbar-actions">
      <div className="app-topbar-theme-toggle">
  <ThemeToggle />
</div>
  <button
  type="button"
  className="app-topbar-user-trigger"
  onClick={() => setMenuOpen((value) => !value)}
  aria-expanded={menuOpen}
  aria-label="用户菜单"
>
  <span className="app-topbar-avatar">
    <UserAvatar user={user} />
  </span>
</button>

  {menuOpen ? (
    <div className="app-topbar-menu" data-user-menu-panel>
      <Link href="/profile" onClick={() => setMenuOpen(false)}>
        个人病历
      </Link>
      

      <Link href="/notifications" onClick={() => setMenuOpen(false)}>
        消息中心
      </Link>

      <Link href="/profile?module=favorites#profile-modules" onClick={() => setMenuOpen(false)}>
        我的收藏
      </Link>

      <Link href="/settings/security" onClick={() => setMenuOpen(false)}>
        账号安全
      </Link>

      <Link href="/settings/privacy" onClick={() => setMenuOpen(false)}>
        隐私设置
      </Link>

      {canAccessAdmin ? (
        <Link href="/admin" onClick={() => setMenuOpen(false)} className="app-topbar-admin-link">
          后台管理
        </Link>
      ) : null}

      <button type="button" onClick={logout}>
        退出登录
      </button>
    </div>
  ) : null}
</div>
  </header>
}
