'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

export type MusicCarouselAlbum = {
  id: string
  name: string
  releaseYear: number
  coverUrl: string
  language: string
  artist: string
  songCount: number
  releaseLabel: string
}

type MusicAlbumCardProps = {
  album: MusicCarouselAlbum
  offset: number
  spacing: number
  selected: boolean
  onActivate: () => void
}

export function MusicAlbum3DCard({ album, offset, spacing, selected, onActivate }: Readonly<MusicAlbumCardProps>) {
  const distance = Math.abs(offset)

  return (
    <motion.button
      type="button"
      aria-label={selected ? `打开专辑《${album.name}》` : `选择专辑《${album.name}》`}
      onClick={onActivate}
      initial={false}
      animate={{
        x: offset * spacing,
        y: selected ? -10 : Math.min(distance * 8, 16),
        scale: selected ? 1.1 : 0.9,
        opacity: selected ? 1 : Math.max(0.42, 0.72 - distance * 0.08),
      }}
      whileHover={{ y: selected ? -16 : -10, scale: selected ? 1.1 : 0.95 }}
      transition={{ type: 'spring', stiffness: 210, damping: 26 }}
      style={{ zIndex: selected ? 20 : 10 - distance }}
      className="absolute left-1/2 top-4 w-[72vw] max-w-[260px] -translate-x-1/2 text-left outline-none focus-visible:rounded-[24px] focus-visible:ring-4 focus-visible:ring-sky-300/70 sm:w-[220px] lg:w-[260px]"
    >
      <span className={`relative block aspect-square overflow-hidden rounded-[24px] border transition-shadow duration-500 ${selected ? 'border-sky-200/45 shadow-[0_24px_70px_rgba(39,154,241,0.32)]' : 'border-white/15 shadow-[0_16px_45px_rgba(2,12,27,0.35)]'}`}>
        <Image
          src={album.coverUrl}
          alt={`${album.name}专辑封面`}
          fill
          sizes="(max-width: 639px) 72vw, (max-width: 1023px) 220px, 260px"
          loading="lazy"
          className="object-cover"
        />
      </span>
      <span className="mt-4 block px-1 text-white">
        <span className="block truncate text-lg font-black tracking-tight sm:text-xl">《{album.name}》</span>
        <span className="mt-1.5 flex items-center gap-2 text-xs font-bold text-slate-300/75 sm:text-sm">
          <span>{album.releaseLabel}</span>
          <span aria-hidden="true" className="h-1 w-1 rounded-full bg-sky-300/60" />
          <span>{album.songCount} Tracks</span>
        </span>
      </span>
    </motion.button>
  )
}
