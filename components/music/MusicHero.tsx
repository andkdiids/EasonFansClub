'use client'

import { MusicAlbumCarousel } from '@/components/music/MusicAlbumCarousel'
import type { MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'
import { MusicSearchDialog } from '@/components/music/MusicSearchDialog'

export function MusicHero({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  return <section className="relative w-full pt-4 sm:pt-6">
    <header className="relative mx-auto max-w-3xl text-center">

      <h1 className="text-[38px font-black tracking-[-0.05em] text-white sm:text-5xl md:text-[64px]">EasMusic</h1>
      <p className="mx-auto mt-4 max-w-xl text-sm font-medium leading-7 text-slate-300/75 sm:text-base">在旋律中遇见陈奕迅，<br className="sm:hidden" />聆听每一个时代的故事。</p>
      <div className="mt-6"><MusicSearchDialog variant="glass" /></div>
    </header>
    <div className="relative mt-9"><MusicAlbumCarousel albums={albums} /></div>
  </section>
}
