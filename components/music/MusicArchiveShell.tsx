'use client'

import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

type MusicArchiveShellProps = { children: ReactNode; maxWidth?: 'max-w-5xl' | 'max-w-6xl' | 'max-w-7xl'; variant?: 'archive' | 'home' }

const particles = [
  { left: '8%', top: '14%', size: 2, delay: '-5s', duration: '27s' },
  { left: '18%', top: '56%', size: 1, delay: '-17s', duration: '31s' },
  { left: '31%', top: '29%', size: 3, delay: '-11s', duration: '29s' },
  { left: '43%', top: '78%', size: 1, delay: '-21s', duration: '34s' },
  { left: '55%', top: '20%', size: 2, delay: '-8s', duration: '25s' },
  { left: '68%', top: '64%', size: 2, delay: '-15s', duration: '32s' },
  { left: '79%', top: '38%', size: 1, delay: '-3s', duration: '28s' },
  { left: '91%', top: '18%', size: 3, delay: '-19s', duration: '35s' },
  { left: '87%', top: '82%', size: 1, delay: '-12s', duration: '30s' },
]

export function MusicArchiveShell({ children, maxWidth = 'max-w-7xl', variant = 'archive' }: Readonly<MusicArchiveShellProps>) {
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
    <div className={`pointer-events-none absolute inset-0 ${isHome ? 'bg-[radial-gradient(circle_at_50%_35%,rgba(45,110,185,.20),transparent_45%),linear-gradient(180deg,#06101d_0%,#07192d_55%,#071523_100%)]' : 'bg-[linear-gradient(145deg,#050914_0%,#07182d_50%,#0b2038_100%)]'}`} />
    <div className={`pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(186,230,253,.65)_0,rgba(186,230,253,.65)_1px,transparent_1.5px)] [mask-image:linear-gradient(to_bottom,black,transparent_82%)] ${isHome ? 'opacity-[0.12] [background-size:118px_118px]' : 'opacity-30 [background-size:72px_72px]'}`} />
    {isHome ? <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-sky-100/[0.06] to-transparent" /> : null}
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 opacity-70">{particles.map((particle, index) => <span key={index} className="music-page-particle absolute rounded-full bg-sky-100/35 blur-[.3px]" style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size, animationDelay: particle.delay, animationDuration: particle.duration }} />)}</div>
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 hidden md:block" style={{ background: 'radial-gradient(340px circle at var(--music-pointer-x, 50%) var(--music-pointer-y, 18%), rgba(78, 169, 235, 0.12), transparent 72%)' }} />
    <motion.div aria-hidden="true" animate={reducedMotion ? undefined : { x: ['-8%', '10%', '-8%'], y: ['-4%', '7%', '-4%'] }} transition={reducedMotion ? undefined : { duration: 22, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -left-40 top-24 z-0 h-[520px] w-[520px] rounded-full bg-sky-500/15 blur-[130px]" />
    {!isHome ? <motion.div aria-hidden="true" animate={reducedMotion ? undefined : { x: ['8%', '-7%', '8%'], y: ['5%', '-6%', '5%'] }} transition={reducedMotion ? undefined : { duration: 26, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -right-48 top-[38rem] z-0 h-[580px] w-[580px] rounded-full bg-blue-600/15 blur-[150px]" /> : null}
    <div className={`relative z-10 mx-auto ${maxWidth} px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-9`}>{children}</div>
  </main>
}
