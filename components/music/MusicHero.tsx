'use client'

import { motion } from 'framer-motion'
import { MusicAlbumCarousel } from '@/components/music/MusicAlbumCarousel'
import type { MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'
import { MusicSearchDialog } from '@/components/music/MusicSearchDialog'

const stars = [[18, 22, 0], [33, 72, 1.8], [52, 16, 0.8], [71, 66, 2.6], [86, 30, 1.2], [94, 78, 3.1]]

export function MusicHero({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  return <section className="relative w-full pt-4 sm:pt-6">
    {stars.map(([left, top, delay]) => <motion.span key={`${left}-${top}`} aria-hidden="true" className="pointer-events-none absolute h-1 w-1 rounded-full bg-sky-100/45" style={{ left: `${left}%`, top: `${top}%` }} animate={{ opacity: [0.12, 0.55, 0.12] }} transition={{ duration: 5, delay, repeat: Infinity, ease: 'easeInOut' }} />)}
    <header className="relative mx-auto max-w-3xl text-center">
      <p className="text-[10px] font-black tracking-[0.3em] text-sky-300/65 sm:text-xs">PRIVATE MUSIC ARCHIVE</p>
      <h1 className="mt-3 text-[38px] font-black tracking-[-0.05em] text-white sm:text-5xl lg:text-[64px]">EasMusic</h1>
      <p className="mx-auto mt-4 max-w-xl text-sm font-medium leading-7 text-slate-300/75 sm:text-base">在旋律中遇见陈奕迅，<br className="sm:hidden" />聆听每一个时代的故事。</p>
      <div className="mt-6"><MusicSearchDialog variant="glass" /></div>
    </header>
    <div className="relative mt-9"><MusicAlbumCarousel albums={albums} /></div>
  </section>
}
