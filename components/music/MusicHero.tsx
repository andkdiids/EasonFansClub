'use client'

import { motion } from 'framer-motion'
import { MusicAlbumCarousel } from '@/components/music/MusicAlbumCarousel'
import type { MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'
import { MusicSearchDialog } from '@/components/music/MusicSearchDialog'

const particles = [
  [8, 22, 0], [14, 70, 1.2], [21, 42, 2.1], [29, 82, 0.7], [36, 16, 2.8],
  [44, 62, 1.7], [52, 31, 0.4], [61, 77, 2.5], [69, 19, 1.4], [76, 55, 3.1],
  [84, 33, 0.9], [91, 72, 2.3], [18, 91, 3.3], [72, 88, 1.9], [95, 13, 2.7],
]

export function MusicHero({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  return (
    <section className="relative isolate overflow-hidden rounded-[32px] border border-sky-200/10 bg-[#050914] px-3 pb-8 pt-12 shadow-[0_30px_100px_rgba(2,18,38,0.28)] sm:rounded-[44px] sm:px-6 sm:pb-10 sm:pt-16 lg:px-10">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,#050914_0%,#07182d_48%,#0b2038_100%)]" />
      <motion.div
        aria-hidden="true"
        animate={{ x: ['-8%', '9%', '-8%'], y: ['-5%', '6%', '-5%'], scale: [1, 1.12, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -left-24 top-8 h-72 w-72 rounded-full bg-sky-500/20 blur-[90px] sm:h-[430px] sm:w-[430px]"
      />
      <motion.div
        aria-hidden="true"
        animate={{ x: ['8%', '-10%', '8%'], y: ['4%', '-8%', '4%'], scale: [1.08, 0.94, 1.08] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
        className="pointer-events-none absolute -right-28 top-28 h-80 w-80 rounded-full bg-blue-700/20 blur-[110px] sm:h-[480px] sm:w-[480px]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(110deg,transparent_20%,rgba(72,176,255,.05)_48%,transparent_72%)]" />
      {particles.map(([left, top, delay], index) => (
        <motion.span
          key={`${left}-${top}`}
          aria-hidden="true"
          className="pointer-events-none absolute h-1 w-1 rounded-full bg-sky-200/60 shadow-[0_0_10px_rgba(125,211,252,.65)]"
          style={{ left: `${left}%`, top: `${top}%` }}
          animate={{ opacity: [0.15, 0.75, 0.15], y: [0, -10, 0] }}
          transition={{ duration: 4 + index % 3, delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      <header className="relative z-10 mx-auto max-w-3xl text-center">
        <p className="text-xs font-black tracking-[0.32em] text-sky-300/75">PRIVATE MUSIC ARCHIVE</p>
        <h1 className="mt-4 text-5xl font-black tracking-[-0.05em] text-white sm:text-7xl lg:text-8xl">EasMusic</h1>
        <p className="mx-auto mt-5 max-w-xl text-sm font-medium leading-7 text-slate-300/80 sm:text-base sm:leading-8">在旋律中遇见陈奕迅，<br className="sm:hidden" />聆听每一个时代的故事。</p>
        <div className="mt-7">
          <MusicSearchDialog variant="glass" />
        </div>
      </header>

      <div className="relative z-10 mt-10 sm:mt-12">
        <MusicAlbumCarousel albums={albums} />
      </div>
    </section>
  )
}
