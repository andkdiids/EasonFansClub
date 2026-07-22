'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { BrandMark } from '@/components/BrandMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { UiIcon } from '@/components/UiIcon'
import type { SessionUser } from '@/lib/auth'
import { isMusicRoute } from '@/lib/navigation'

export function Topbar({ user, logoUrl, unreadCount }: Readonly<{ user: SessionUser; logoUrl: string | null; unreadCount: number }>) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const home = pathname === '/community'
  const inverse = home || isMusicRoute(pathname)
  const name = user.nickname || user.username

  async function logout() {
    if ((await fetch('/api/auth/logout', { method: 'POST' })).ok) location.replace('/login')
  }

  return <header className={`app-topbar ${home ? 'app-topbar-home' : ''} ${inverse ? 'app-topbar-inverse' : ''}`}>
    <Link href="/community" className="app-topbar-brand" aria-label="社区首页"><BrandMark logoUrl={logoUrl} inverse={inverse} compact /></Link>
    <form action="/search" className="app-topbar-search" role="search">
      <UiIcon name="search" />
      <input name="q" aria-label="搜索帖子、歌曲、专辑和用户" placeholder="搜索帖子、歌曲、专辑、用户…" />
    </form>
    <div className="app-topbar-actions">
      <Link href="/posts/new" aria-label="发布帖子"><UiIcon name="edit" /></Link>
      <Link href="/notifications" aria-label={`通知，${unreadCount}条未读`} className="app-topbar-notification"><UiIcon name="bell" />{unreadCount > 0 ? <b>{unreadCount}</b> : null}</Link>
      <ThemeToggle />
      <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-expanded={menuOpen} aria-label="用户菜单">
        <span className="app-topbar-avatar">{user.avatarUrl ? <Image src={user.avatarUrl} alt={`${name}的头像`} fill sizes="34px" className="object-cover" /> : name[0]}</span>
        <UiIcon name="menu" />
      </button>
      {menuOpen ? <div className="app-topbar-menu"><Link href="/profile">我的主页</Link><Link href="/settings/security">账号安全</Link><button type="button" onClick={logout}>退出登录</button></div> : null}
    </div>
  </header>
}
