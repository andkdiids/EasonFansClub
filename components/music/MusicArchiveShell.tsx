'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

type MusicArchiveShellProps = { children: ReactNode; maxWidth?: 'max-w-5xl' | 'max-w-6xl' | 'max-w-7xl' }

export function MusicArchiveShell({ children, maxWidth = 'max-w-7xl' }: Readonly<MusicArchiveShellProps>) {
  return <main className="relative isolate min-h-screen overflow-hidden bg-[#050914] text-white">
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,#050914_0%,#07182d_50%,#0b2038_100%)]" />
    <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_center,rgba(186,230,253,.7)_0,rgba(186,230,253,.7)_1px,transparent_1.5px)] [background-size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_82%)]" />
    <motion.div aria-hidden="true" animate={{ x: ['-8%', '10%', '-8%'], y: ['-4%', '7%', '-4%'] }} transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -left-40 top-24 h-[520px] w-[520px] rounded-full bg-sky-500/15 blur-[130px]" />
    <motion.div aria-hidden="true" animate={{ x: ['8%', '-7%', '8%'], y: ['5%', '-6%', '5%'] }} transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }} className="pointer-events-none absolute -right-48 top-[38rem] h-[580px] w-[580px] rounded-full bg-blue-600/15 blur-[150px]" />
    <div className={`relative mx-auto ${maxWidth} px-4 py-8 sm:px-5 sm:py-12`}>{children}</div>
  </main>
}
