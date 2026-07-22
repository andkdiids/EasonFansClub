'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { MusicParticleCanvas } from '@/components/music/MusicParticleCanvas'
import { HeroBackground } from '@/components/HeroBackground'
import type { SiteHeroVisualConfig } from '@/lib/hero-visuals'

type MusicArchiveShellProps = { children: ReactNode; maxWidth?: 'max-w-5xl' | 'max-w-6xl' | 'max-w-7xl'; variant?: 'archive' | 'home'; backgroundVisual?: SiteHeroVisualConfig | null }

export function MusicArchiveShell({ children, maxWidth = 'max-w-7xl', variant = 'archive', backgroundVisual }: Readonly<MusicArchiveShellProps>) {
  const isHome = variant === 'home'
  const reducedMotion = useReducedMotion()
  const shellRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const shell = shellRef.current
    if (!shell || reducedMotion || !window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 768px)').matches) return
    let frame = 0
    const onPointerMove = (event: PointerEvent) => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const rect = shell.getBoundingClientRect()
        shell.style.setProperty('--music-pointer-x', `${event.clientX - rect.left}px`)
        shell.style.setProperty('--music-pointer-y', `${event.clientY - rect.top}px`)
      })
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onPointerMove)
    }
  }, [reducedMotion])

  return <main ref={shellRef} className="relative isolate min-h-screen overflow-hidden bg-[#06101d] text-white">
    <HeroBackground visual={backgroundVisual} className="opacity-25 saturate-50" />
    <div className={`pointer-events-none absolute inset-0 ${isHome ? 'bg-[radial-gradient(circle_at_50%_35%,rgba(45,110,185,.20),transparent_45%),linear-gradient(180deg,#06101d_0%,#07192d_55%,#071523_100%)]' : 'bg-[linear-gradient(145deg,#050914_0%,#07182d_50%,#0b2038_100%)]'}`} />
    <div className={`pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(186,230,253,.65)_0,rgba(186,230,253,.65)_1px,transparent_1.5px)] [mask-image:linear-gradient(to_bottom,black,transparent_82%)] ${isHome ? 'opacity-[0.12] [background-size:118px_118px]' : 'opacity-30 [background-size:72px_72px]'}`} />
    {isHome ? <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-sky-100/[0.06] to-transparent" /> : null}
    <MusicParticleCanvas />
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 hidden md:block" style={{ background: 'radial-gradient(340px circle at var(--music-pointer-x, 50%) var(--music-pointer-y, 18%), rgba(78, 169, 235, 0.12), transparent 72%)' }} />
    <motion.div aria-hidden="true" animate={reducedMotion ? undefined : { x: ['-8%', '10%', '-8%'], y: ['-4%', '7%', '-4%'] }} transition={reducedMotion ? undefined : { duration: 22, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -left-40 top-24 z-0 h-[520px] w-[520px] rounded-full bg-sky-500/15 blur-[130px]" />
    {!isHome ? <motion.div aria-hidden="true" animate={reducedMotion ? undefined : { x: ['8%', '-7%', '8%'], y: ['5%', '-6%', '5%'] }} transition={reducedMotion ? undefined : { duration: 26, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -right-48 top-[38rem] z-0 h-[580px] w-[580px] rounded-full bg-blue-600/15 blur-[150px]" /> : null}
    <div className={`relative z-10 mx-auto ${maxWidth} px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-9`}>{children}</div>
  </main>
}
