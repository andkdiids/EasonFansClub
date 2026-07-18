'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

export type MusicCarouselAlbum = { id: string; name: string; releaseYear: number; coverUrl: string; language: string; artist: string; songCount: number; releaseLabel: string }

type MusicAlbumCardProps = { album: MusicCarouselAlbum; offset: number; spacing: number; selected: boolean; disabled?: boolean; onActivate: () => void }

export function MusicAlbum3DCard({ album, offset, spacing, selected, disabled = false, onActivate }: Readonly<MusicAlbumCardProps>) {
  const distance = Math.abs(offset)
  return <div className="absolute left-1/2 top-2 w-[62vw] max-w-[238px] -translate-x-1/2 md:w-[220px] lg:w-[260px] lg:max-w-[260px]" style={{ zIndex: selected ? 20 : 10 - distance }}>
    <motion.button
      type="button"
      disabled={disabled}
      aria-label={selected ? `打开专辑《${album.name}》` : `选择专辑《${album.name}》`}
      onClick={onActivate}
      initial={false}
      animate={{ x: offset * spacing, y: selected ? -5 : 4, scale: selected ? 1.06 : 0.92, opacity: selected ? 1 : 0.6 }}
      whileHover={disabled ? undefined : { y: -10, scale: selected ? 1.06 : 0.97 }}
      transition={{ type: 'spring', stiffness: 205, damping: 27 }}
      className="w-full text-left outline-none disabled:pointer-events-none focus-visible:rounded-[24px] focus-visible:ring-4 focus-visible:ring-sky-300/60"
    >
      <span className={`relative block aspect-square overflow-hidden rounded-[24px] border transition-shadow duration-300 ${selected ? 'border-white/[0.12] shadow-[0_20px_55px_rgba(35,145,230,.2)]' : 'border-white/[0.08] shadow-[0_14px_35px_rgba(2,12,27,.25)]'}`}>
        <Image src={album.coverUrl} alt={`${album.name}专辑封面`} fill sizes="(max-width:767px) 62vw, (max-width:1023px) 220px, 260px" loading="lazy" className="object-cover" />
      </span>
      <span className="mt-4 block px-1 text-white"><span className="block truncate text-lg font-black tracking-tight sm:text-xl">《{album.name}》</span><span className="mt-1.5 flex items-center gap-2 text-xs font-bold text-slate-300/70 sm:text-sm"><span>{album.releaseLabel}</span><span aria-hidden="true" className="h-1 w-1 rounded-full bg-sky-300/45" /><span>{album.songCount} Tracks</span></span></span>
    </motion.button>
  </div>
}
