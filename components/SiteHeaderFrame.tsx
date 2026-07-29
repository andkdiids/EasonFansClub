'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { isMusicRoute } from '@/lib/navigation'

export function SiteHeaderFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  const musicTheme = isMusicRoute(pathname)
  const homeRoute = pathname === '/'

  return (
    <header
      data-music-theme={musicTheme ? 'true' : 'false'}
      className={`site-header-frame sticky top-0 z-[var(--layer-sticky)] overflow-x-clip ${musicTheme ? 'site-header-frame-music' : ''} ${homeRoute ? 'site-header-frame-home' : ''}`}
    >
      <div className="relative z-10">{children}</div>
    </header>
  )
}
