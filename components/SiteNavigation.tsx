'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isMusicRoute, isNavigationItemActive } from '@/lib/navigation'

export type SiteNavigationItem = { href: string; label: string; icon: string; title?: string | null }

export function DesktopSiteNavigation({ items, isAdmin }: Readonly<{ items: SiteNavigationItem[]; isAdmin: boolean }>) {
  const pathname = usePathname()
  const musicTheme = isMusicRoute(pathname)
  return <nav className="site-desktop-nav hidden min-w-0 flex-1 items-stretch justify-center overflow-x-auto text-sm md:flex">
    {items.map((item) => {
      const active = isNavigationItemActive(pathname, item.href)
      return <Link key={item.href} href={item.href} title={item.title || item.label} aria-current={active ? 'page' : undefined} className={`site-nav-link ${musicTheme ? 'site-nav-link-music' : ''}`}><span className="site-nav-icon" aria-hidden>{item.icon}</span><span>{item.label}</span></Link>
    })}
    {isAdmin ? <Link href="/admin" title="后台" aria-current={isNavigationItemActive(pathname, '/admin') ? 'page' : undefined} className="site-nav-link"><span className="site-nav-icon" aria-hidden>⚙</span><span>后台</span></Link> : null}
  </nav>
}

export function MobileSiteNavigation({ items }: Readonly<{ items: SiteNavigationItem[] }>) {
  const pathname = usePathname()
  const musicTheme = isMusicRoute(pathname)
  return <nav data-mobile-main-nav className={`site-mobile-nav fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t md:hidden ${musicTheme ? 'site-mobile-nav-music' : ''}`}>
    {items.map((item) => {
      const active = isNavigationItemActive(pathname, item.href)
      return <Link key={item.href} href={item.href} title={item.title || item.label} aria-current={active ? 'page' : undefined} className="site-mobile-nav-link"><span className="text-lg" aria-hidden>{item.icon}</span><span>{item.label}</span></Link>
    })}
  </nav>
}
