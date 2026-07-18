'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export type SiteNavigationItem = { href: string; label: string; icon: string; title?: string | null }

function isNavigationItemActive(pathname: string, href: string) {
  const target = href.split(/[?#]/)[0].replace(/\/$/, '') || '/'
  if (!target.startsWith('/')) return false
  if (target === '/') return pathname === '/'
  return pathname === target || pathname.startsWith(`${target}/`)
}

export function DesktopSiteNavigation({ items, isAdmin }: Readonly<{ items: SiteNavigationItem[]; isAdmin: boolean }>) {
  const pathname = usePathname()
  return <nav className="hidden min-w-0 flex-1 items-center justify-center gap-2 overflow-x-auto text-sm font-bold md:flex">
    {items.map((item) => {
      const active = isNavigationItemActive(pathname, item.href)
      return <Link key={item.href} href={item.href} title={item.title || item.label} aria-current={active ? 'page' : undefined} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-lg transition duration-200 ${active ? 'border-brand-500/20 bg-brand-700 text-white shadow-md shadow-brand-950/15' : 'border-transparent text-brand-950/45 hover:border-sky-100 hover:bg-sky-50 hover:text-brand-950'}`}><span aria-hidden>{item.icon}</span><span className="sr-only">{item.label}</span></Link>
    })}
    {isAdmin ? <Link href="/admin" title="后台" aria-current={isNavigationItemActive(pathname, '/admin') ? 'page' : undefined} className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg transition ${isNavigationItemActive(pathname, '/admin') ? 'bg-brand-700 text-white' : 'text-brand-700/55 hover:bg-sky-50 hover:text-brand-700'}`}><span aria-hidden>⚙</span><span className="sr-only">后台</span></Link> : null}
  </nav>
}

export function MobileSiteNavigation({ items }: Readonly<{ items: SiteNavigationItem[] }>) {
  const pathname = usePathname()
  return <nav data-mobile-main-nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 gap-1 rounded-[24px] border border-sky-100 bg-white/92 p-2 shadow-2xl shadow-sky-900/10 backdrop-blur-xl transition md:hidden">
    {items.map((item) => {
      const active = isNavigationItemActive(pathname, item.href)
      return <Link key={item.href} href={item.href} title={item.title || item.label} aria-current={active ? 'page' : undefined} className={`flex min-h-12 flex-col items-center justify-center rounded-2xl transition duration-200 ${active ? 'bg-brand-700 text-white shadow-md shadow-brand-950/15' : 'text-brand-950/45 hover:bg-sky-50 hover:text-brand-950'}`}><span className="text-lg" aria-hidden>{item.icon}</span><span className="mt-0.5 max-w-full truncate text-[10px] font-black">{item.label}</span></Link>
    })}
  </nav>
}
