'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

type MusicArchiveShellProps = { children: ReactNode; maxWidth?: 'max-w-5xl' | 'max-w-6xl' | 'max-w-7xl'; variant?: 'archive' | 'home' }

export function MusicArchiveShell({ children, maxWidth = 'max-w-7xl', variant = 'archive' }: Readonly<MusicArchiveShellProps>) {
  const isHome = variant === 'home'
  return <main className="relative isolate min-h-screen overflow-hidden bg-[#06101d] text-white">
    <div className={`pointer-events-none absolute inset-0 ${isHome ? 'bg-[radial-gradient(circle_at_50%_35%,rgba(45,110,185,.20),transparent_45%),linear-gradient(180deg,#06101d_0%,#07192d_55%,#071523_100%)]' : 'bg-[linear-gradient(145deg,#050914_0%,#07182d_50%,#0b2038_100%)]'}`} />
    <div className={`pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_center,rgba(186,230,253,.65)_0,rgba(186,230,253,.65)_1px,transparent_1.5px)] [mask-image:linear-gradient(to_bottom,black,transparent_82%)] ${isHome ? 'opacity-[0.12] [background-size:118px_118px]' : 'opacity-30 [background-size:72px_72px]'}`} />
    {isHome ? <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-sky-100/[0.06] to-transparent" /> : null}
    <motion.div aria-hidden="true" animate={{ x: ['-8%', '10%', '-8%'], y: ['-4%', '7%', '-4%'] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -left-40 top-24 h-[520px] w-[520px] rounded-full bg-sky-500/15 blur-[130px]" />
    {!isHome ? <motion.div aria-hidden="true" animate={{ x: ['8%', '-7%', '8%'], y: ['5%', '-6%', '5%'] }} transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -right-48 top-[38rem] h-[580px] w-[580px] rounded-full bg-blue-600/15 blur-[150px]" /> : null}
    <div className={`relative mx-auto ${maxWidth} px-4 pb-12 pt-7 sm:px-5 sm:pb-16 sm:pt-9`}>{children}</div>
  </main>
}
