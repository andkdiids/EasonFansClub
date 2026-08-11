'use client'

import { useState } from 'react'
import { MusicAlbumCard } from '@/components/music/MusicAlbumCard'
import type { MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'
import { MusicHero } from '@/components/music/MusicHero'

type ArchiveAlbum = {
  id: string
  name: string
  artist: string
  releaseYear: number
  language: string
  coverUrl?: string | null
  songCount: number
}

export function MusicAlbumArchiveShowcase({ carouselAlbums, albums }: Readonly<{ carouselAlbums: MusicCarouselAlbum[]; albums: ArchiveAlbum[] }>) {
  const [expanded, setExpanded] = useState(false)
  return <section aria-labelledby="album-archive-showcase-title">
    <MusicHero albums={carouselAlbums} />
    <div className="mt-2 text-center">
      <p id="album-archive-showcase-title" className="text-xs font-black tracking-[0.22em] text-sky-300/60">COMPLETE ALBUM ARCHIVE</p>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} className="mt-4 min-h-11 rounded-full border border-sky-200/25 bg-sky-200/[0.08] px-7 text-sm font-black text-sky-100 shadow-[0_14px_40px_rgba(2,12,27,.25)] transition hover:-translate-y-0.5 hover:border-sky-200/40 hover:bg-sky-200/[0.13]">
        {expanded ? '收起全部专辑' : `展开全部专辑 · ${albums.length}`}
      </button>
    </div>
    {expanded ? <div className="mt-8 grid min-w-0 grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 md:grid-cols-5 xl:grid-cols-6">
      {albums.map((album) => <MusicAlbumCard key={album.id} theme="dark" album={album} />)}
    </div> : null}
  </section>
}
