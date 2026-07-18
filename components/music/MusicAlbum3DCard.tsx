'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'
import { formatTrackCount } from '@/lib/music-display'

export type MusicCarouselAlbum = { id: string; name: string; releaseYear: number; coverUrl: string; language: string; artist: string; songCount: number; releaseLabel: string }

type MusicAlbumCardProps = { album: MusicCarouselAlbum; offset: number; spacing: number; selected: boolean; disabled?: boolean; onActivate: () => void }

export function MusicAlbum3DCard({ album, offset, spacing, selected, disabled = false, onActivate }: Readonly<MusicAlbumCardProps>) {
  const distance = Math.abs(offset)
  return <div data-carousel-state={selected ? 'active' : distance === 1 ? 'adjacent' : 'hidden'} className="absolute left-1/2 top-2 w-[clamp(210px,58vw,238px)] -translate-x-1/2 md:w-[220px] lg:w-[260px]" style={{ zIndex: selected ? 30 : distance === 1 ? 10 : 0 }}>
    <motion.button
      type="button"
      disabled={disabled}
      aria-label={selected ? `打开专辑《${album.name}》` : `选择专辑《${album.name}》`}
      onClick={onActivate}
      initial={false}
      animate={{ x: offset * spacing, y: selected ? -3 : 3, scale: selected ? 1 : 0.88, opacity: selected ? 1 : 0.52 }}
      whileHover={disabled ? undefined : { y: -7, scale: selected ? 1.03 : 0.9 }}
      transition={{ type: 'spring', stiffness: 205, damping: 27 }}
      className="w-full text-left outline-none disabled:pointer-events-none focus-visible:rounded-[24px] focus-visible:ring-4 focus-visible:ring-sky-300/60"
    >
      <span className={`relative block aspect-square overflow-hidden rounded-[24px] border transition-shadow duration-300 ${selected ? 'border-white/[0.12] shadow-[0_20px_55px_rgba(35,145,230,.2)]' : 'border-white/[0.08] shadow-[0_14px_35px_rgba(2,12,27,.25)]'}`}>
        <Image src={album.coverUrl} alt={`${album.name}专辑封面`} fill sizes="(max-width:767px) 62vw, (max-width:1023px) 220px, 260px" loading="lazy" className="object-cover" />
      </span>
      <span className="mt-4 hidden px-1 text-white md:block"><span className="block truncate text-lg font-black tracking-tight sm:text-xl">《{album.name}》</span><span className="mt-1.5 flex items-center gap-2 text-xs font-bold text-slate-300/70 sm:text-sm"><span>{album.releaseLabel}</span><span aria-hidden="true" className="h-1 w-1 rounded-full bg-sky-300/45" /><span>{formatTrackCount(album.songCount)}</span></span></span>
    </motion.button>
  </div>
}
