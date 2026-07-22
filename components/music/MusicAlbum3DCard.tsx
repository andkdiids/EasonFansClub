'use client'

import Link from 'next/link'
import { useState, type CSSProperties } from 'react'
import { formatTrackCount } from '@/lib/music-display'

export type MusicCarouselAlbum = { id: string; name: string; releaseYear: number; coverUrl: string; language: string; artist: string; songCount: number; releaseLabel: string }

type MusicAlbumCardProps = { album: MusicCarouselAlbum; carouselIndex: number; offset: number; spacing: number; cardWidth: number; selected: boolean; disabled?: boolean; onActivate: () => void; cardRef: (element: HTMLDivElement | null) => void }

export function MusicAlbum3DCard({ album, carouselIndex, offset, spacing, cardWidth, selected, disabled = false, onActivate, cardRef }: Readonly<MusicAlbumCardProps>) {
  const distance = Math.abs(offset)
  // 首帧样式在挂载时冻结;之后的位移、缩放、透明度由轮播 rAF 引擎直接写入 DOM(translate3d + scale,GPU 合成),不触发 React render
  const [initialStyle] = useState<CSSProperties>(() => {
    const blend = Math.min(distance, 1)
    const opacityValue = 1 - 0.24 * blend
    return {
      transform: `translate3d(calc(-50% + ${offset * spacing}px), ${-3 + 6 * blend}px, 0) scale(${1 - 0.1 * blend})`,
      opacity: opacityValue,
      zIndex: selected ? 30 : Math.max(1, 12 - distance),
      pointerEvents: opacityValue < 0.05 ? 'none' : undefined,
    }
  })
  const className = `block w-full text-left outline-none transition-transform duration-300 disabled:pointer-events-none focus-visible:rounded-[24px] focus-visible:ring-4 focus-visible:ring-sky-300/60 ${selected ? 'hover:-translate-y-1 hover:scale-[1.03]' : 'hover:-translate-y-2.5 hover:scale-[1.023]'}`
  const content = <>
      <span className={`relative block aspect-square overflow-hidden rounded-[24px] border bg-[#071523] transition-shadow duration-300 ${selected ? 'border-sky-200/20 shadow-[0_16px_42px_rgba(35,145,230,.24)]' : 'border-white/[0.12] shadow-[0_10px_28px_rgba(2,12,27,.2)]'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={album.coverUrl} alt={`${album.name}专辑封面`} loading="lazy" decoding="async" draggable={false} className="absolute inset-0 block h-full w-full object-cover" />
      </span>
      <span className="mt-3 hidden px-1 text-white md:block"><span className="block truncate text-base font-black tracking-tight xl:text-lg">《{album.name}》</span><span className="mt-1 flex items-center gap-1.5 truncate text-[11px] font-bold text-slate-300/70 xl:text-xs"><span>{album.releaseLabel}</span><span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-sky-300/45" /><span>{formatTrackCount(album.songCount)}</span></span></span>
    </>
  return <div ref={cardRef} data-carousel-index={carouselIndex} data-carousel-state={selected ? 'active' : distance <= 2 ? 'adjacent' : 'hidden'} className="absolute left-1/2 top-2 isolate" style={{ width: cardWidth, ...initialStyle, willChange: 'transform, opacity', backfaceVisibility: 'hidden' }}>
    {selected
      ? <Link href={`/music/album/${album.id}`} aria-label={`打开专辑《${album.name}》`} className={className}>{content}</Link>
      : <button type="button" disabled={disabled} aria-label={`选择专辑《${album.name}》`} onClick={onActivate} className={className}>{content}</button>}
  </div>
}
