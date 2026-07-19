'use client'

import { motion, type PanInfo } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MusicAlbum3DCard, type MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'
import { formatTrackCount } from '@/lib/music-display'

export function MusicAlbumCarousel({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  const router = useRouter()
  const stageRef = useRef<HTMLDivElement>(null)
  const wheelLock = useRef(0)
  const [selected, setSelected] = useState(0)
  const [layout, setLayout] = useState({ cardWidth: 238, spacing: 152, visibleRange: 1 })
  const [interactionPaused, setInteractionPaused] = useState(false)

  const move = useCallback((direction: number) => {
    if (interactionPaused) return
    setSelected((current) => albums.length ? (current + direction + albums.length) % albums.length : 0)
  }, [albums.length, interactionPaused])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const syncSpacing = () => {
      const width = stage.getBoundingClientRect().width
      if (window.innerWidth < 768) {
        const cardWidth = Math.min(Math.max(window.innerWidth * 0.58, 210), 238)
        setLayout({ cardWidth, spacing: cardWidth * 0.64, visibleRange: 1 })
      } else if (width >= 940 && albums.length >= 4) {
        const cardWidth = Math.min(220, Math.max(180, (width - 96) / 5))
        setLayout({ cardWidth, spacing: (width - cardWidth) / 4, visibleRange: 2 })
      } else {
        const cardWidth = Math.min(220, Math.max(190, width * 0.28))
        setLayout({ cardWidth, spacing: Math.min(240, width * 0.3), visibleRange: 1 })
      }
    }
    syncSpacing()
    const observer = new ResizeObserver(syncSpacing)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [albums.length])

  useEffect(() => {
    const onDialogState = (event: Event) => setInteractionPaused(Boolean((event as CustomEvent<boolean>).detail))
    window.addEventListener('easmusic:search-dialog', onDialogState)
    return () => window.removeEventListener('easmusic:search-dialog', onDialogState)
  }, [])

  const offsets = useMemo(() => albums.map((_, index) => {
    let value = index - selected
    if (value > albums.length / 2) value -= albums.length
    if (value < -albums.length / 2) value += albums.length
    return value
  }), [albums, selected])

  function onWheel(event: React.WheelEvent) {
    if (interactionPaused) return
    event.preventDefault()
    const now = Date.now()
    if (now - wheelLock.current < 320 || Math.abs(event.deltaY) < 8) return
    wheelLock.current = now
    move(event.deltaY > 0 ? 1 : -1)
  }

  function onDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (!interactionPaused && (Math.abs(info.offset.x) > 45 || Math.abs(info.velocity.x) > 350)) move(info.offset.x < 0 ? 1 : -1)
  }

  if (albums.length === 0) return <div className="mx-auto grid min-h-[320px] w-full max-w-[660px] place-items-center rounded-[24px] border border-white/10 bg-white/[0.04] p-8 text-center text-sm font-bold text-white/65">暂无已发布专辑。管理员发布专辑后会自动出现在这里。</div>
  const current = albums[selected]

  return <section aria-label="精选专辑轮播" tabIndex={interactionPaused ? -1 : 0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1) }} onWheel={onWheel} className="relative isolate z-0 mx-auto flex w-full max-w-7xl flex-col items-center outline-none focus-visible:ring-4 focus-visible:ring-sky-300/50">
    <div className="relative flex w-full justify-center">
      <button type="button" disabled={interactionPaused} onClick={() => move(-1)} aria-label="上一张专辑" className="absolute left-0 top-[112px] z-20 hidden size-[52px] -translate-y-1/2 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-2xl text-white shadow-lg shadow-transparent backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-white/[0.12] hover:shadow-sky-950/25 disabled:pointer-events-none md:grid lg:top-[132px]">‹</button>
      <motion.div ref={stageRef} drag={interactionPaused ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.14} onDragEnd={onDragEnd} className={`relative isolate h-[250px] w-full touch-pan-y sm:h-[280px] md:h-[330px] md:w-[calc(100%-144px)] lg:h-[340px] xl:w-[calc(100%-160px)] ${interactionPaused ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}>
        {albums.map((album, index) => Math.abs(offsets[index]) <= layout.visibleRange ? <MusicAlbum3DCard key={album.id} album={album} offset={offsets[index]} spacing={layout.spacing} cardWidth={layout.cardWidth} selected={index === selected} disabled={interactionPaused} onActivate={() => index === selected ? router.push(`/music/album/${album.id}`) : setSelected(index)} /> : null)}
      </motion.div>
      <button type="button" disabled={interactionPaused} onClick={() => move(1)} aria-label="下一张专辑" className="absolute right-0 top-[112px] z-20 hidden size-[52px] -translate-y-1/2 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-2xl text-white shadow-lg shadow-transparent backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-white/[0.12] hover:shadow-sky-950/25 disabled:pointer-events-none md:grid lg:top-[132px]">›</button>
    </div>
    <div className="mb-4 text-center text-white md:hidden"><p className="line-clamp-1 text-base font-black">《{current.name}》</p><p className="mt-1 text-xs font-bold text-slate-300/65">{current.releaseLabel} · {current.language} · {formatTrackCount(current.songCount)}</p></div>
    <div className="relative z-20 mt-1 flex items-center justify-center">
      <button type="button" disabled={interactionPaused} onClick={() => router.push(`/music/album/${current.id}`)} className="rounded-full border border-white/[0.12] bg-white/[0.08] px-5 py-3 text-sm font-black text-white backdrop-blur-md transition hover:bg-white/[0.12] disabled:pointer-events-none sm:px-6">查看当前专辑</button>
    </div>
  </section>
}
