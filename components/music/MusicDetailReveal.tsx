'use client'

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

type MusicDetailRevealProps = { children: ReactNode; className?: string; delay?: number; direction?: 'left' | 'right' | 'up'; hover?: boolean }

export function MusicDetailReveal({ children, className = '', delay = 0, direction = 'up', hover = false }: Readonly<MusicDetailRevealProps>) {
  const initial = direction === 'left' ? { opacity: 0, x: -24 } : direction === 'right' ? { opacity: 0, x: 24 } : { opacity: 0, y: 18 }
  return <motion.div initial={initial} animate={{ opacity: 1, x: 0, y: 0 }} whileHover={hover ? { scale: 1.015, y: -4 } : undefined} transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }} className={className}>{children}</motion.div>
}
