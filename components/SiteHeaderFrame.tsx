'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'
import { isMusicRoute } from '@/lib/navigation'

const particles = [
  { top: '18%', left: '-4%', size: 2, delay: '-4s', duration: '24s' },
  { top: '34%', left: '12%', size: 1, delay: '-12s', duration: '29s' },
  { top: '62%', left: '28%', size: 3, delay: '-18s', duration: '31s' },
  { top: '24%', left: '48%', size: 1, delay: '-7s', duration: '22s' },
  { top: '72%', left: '66%', size: 2, delay: '-16s', duration: '28s' },
  { top: '42%', left: '84%', size: 2, delay: '-10s', duration: '26s' },
]

export function SiteHeaderFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname()
  const musicTheme = isMusicRoute(pathname)

  return (
    <header
      data-music-theme={musicTheme ? 'true' : 'false'}
      className={`sticky top-0 z-[100] overflow-x-clip border-b backdrop-blur-[18px] transition-[background-color,color,border-color,box-shadow] duration-500 ease-out ${musicTheme ? 'border-sky-200/[0.12] bg-[rgba(4,18,34,.78)] shadow-[0_12px_35px_rgba(1,8,18,.22)]' : 'border-sky-100/80 bg-white/88'}`}
    >
      {musicTheme ? <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {particles.map((particle, index) => <span key={index} className="music-nav-particle absolute rounded-full bg-sky-100/30 blur-[.2px]" style={{ top: particle.top, left: particle.left, width: particle.size, height: particle.size, animationDelay: particle.delay, animationDuration: particle.duration }} />)}
      </div> : null}
      <div className="relative z-10">{children}</div>
    </header>
  )
}
