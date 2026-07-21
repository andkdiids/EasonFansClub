'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isMusicRoute, isNavigationItemActive } from '@/lib/navigation'

export type SiteNavigationItem = { href: string; label: string; icon: string; title?: string | null }

export function DesktopSiteNavigation({ items, isAdmin }: Readonly<{ items: SiteNavigationItem[]; isAdmin: boolean }>) {
  const pathname = usePathname()
  const musicTheme = isMusicRoute(pathname)
  return <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto text-sm font-bold md:flex">
    {items.map((item) => {
      const active = isNavigationItemActive(pathname, item.href)
      return <Link key={item.href} href={item.href} title={item.title || item.label} aria-current={active ? 'page' : undefined} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-lg transition duration-500 ${active ? (musicTheme ? 'border-sky-200/20 bg-white/[0.12] text-white shadow-md shadow-sky-950/30' : 'border-brand-500/20 bg-brand-700 text-white shadow-md shadow-brand-950/15') : (musicTheme ? 'border-transparent text-slate-200/55 hover:border-white/10 hover:bg-white/[0.08] hover:text-white' : 'border-transparent text-brand-950/45 hover:border-sky-100 hover:bg-sky-50 hover:text-brand-950')}`}><span aria-hidden>{item.icon}</span><span className="sr-only">{item.label}</span></Link>
    })}
    {isAdmin ? <Link href="/admin" title="后台" aria-current={isNavigationItemActive(pathname, '/admin') ? 'page' : undefined} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg transition ${isNavigationItemActive(pathname, '/admin') ? 'bg-brand-700 text-white' : 'text-brand-700/55 hover:bg-sky-50 hover:text-brand-700'}`}><span aria-hidden>⚙</span><span className="sr-only">后台</span></Link> : null}
  </nav>
}

export function MobileSiteNavigation({ items }: Readonly<{ items: SiteNavigationItem[] }>) {
  const pathname = usePathname()
  const musicTheme = isMusicRoute(pathname)
  return <nav data-mobile-main-nav className={`fixed inset-x-3 bottom-3 z-50 grid grid-cols-5 gap-1 rounded-[24px] border p-2 shadow-2xl backdrop-blur-xl transition duration-500 md:hidden ${musicTheme ? 'border-white/10 bg-[#041222]/90 shadow-black/30' : 'border-sky-100 bg-white/95 shadow-sky-900/10'}`}>
    {items.map((item) => {
      const active = isNavigationItemActive(pathname, item.href)
      return <Link key={item.href} href={item.href} title={item.title || item.label} aria-current={active ? 'page' : undefined} className={`flex min-h-12 flex-col items-center justify-center rounded-2xl transition duration-500 ${active ? (musicTheme ? 'bg-white/[0.12] text-white shadow-md shadow-black/25' : 'bg-brand-700 text-white shadow-md shadow-brand-950/15') : (musicTheme ? 'text-slate-200/50 hover:bg-white/[0.07] hover:text-white' : 'text-brand-950/45 hover:bg-sky-50 hover:text-brand-950')}`}><span className="text-lg" aria-hidden>{item.icon}</span><span className="mt-0.5 max-w-full truncate text-[10px] font-black">{item.label}</span></Link>
    })}
  </nav>
}
