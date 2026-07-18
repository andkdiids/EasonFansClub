'use client'

import Image from 'next/image'
import { motion } from 'framer-motion'

export type MusicCarouselAlbum = { id: string; name: string; releaseYear: number; coverUrl: string; language: string; artist: string }

export function MusicAlbum3DCard({ album, offset, spacing, selected, onActivate }: Readonly<{ album: MusicCarouselAlbum; offset: number; spacing: number; selected: boolean; onActivate: () => void }>) {
  const distance = Math.abs(offset)
  return <motion.button
    type="button"
    aria-label={selected ? `打开专辑《${album.name}》` : `选择专辑《${album.name}》`}
    onClick={onActivate}
    initial={false}
    animate={{ x: offset * spacing, scale: selected ? 1 : Math.max(0.62, 0.86 - distance * 0.08), rotateY: selected ? 0 : offset < 0 ? 38 : -38, opacity: selected ? 1 : Math.max(0.24, 0.72 - distance * 0.16), z: selected ? 80 : -distance * 90 }}
    transition={{ type: 'spring', stiffness: 230, damping: 28 }}
    style={{ zIndex: 20 - distance, transformStyle: 'preserve-3d' }}
    className="absolute left-1/2 top-1/2 aspect-square w-[58vw] max-w-[330px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[28px] border border-white/35 bg-slate-900 text-left shadow-2xl shadow-black/35 outline-none focus-visible:ring-4 focus-visible:ring-sky-300 sm:w-[310px]"
  >
    <Image src={album.coverUrl} alt={`${album.name}专辑封面`} fill sizes="(max-width: 640px) 58vw, 330px" loading="lazy" className="object-cover" />
    <span className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-5 pb-5 pt-16 text-white transition ${selected ? 'opacity-100' : 'opacity-70'}`}><span className="block truncate text-xl font-black">{album.name}</span><span className="mt-1 block text-xs font-bold text-white/75">{album.releaseYear}</span></span>
  </motion.button>
}
