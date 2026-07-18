'use client'

import { motion, type PanInfo } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MusicAlbum3DCard, type MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'

export function MusicAlbumCarousel({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  const router = useRouter()
  const stageRef = useRef<HTMLDivElement>(null)
  const wheelLock = useRef(0)
  const [selected, setSelected] = useState(0)
  const [spacing, setSpacing] = useState(165)
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
      if (width >= 620) setSpacing(165)
      else if (width >= 500) setSpacing(140)
      else {
        const cardWidth = Math.min(width * 0.7, 260)
        setSpacing(width / 2 + cardWidth * 0.35)
      }
    }
    syncSpacing()
    const observer = new ResizeObserver(syncSpacing)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

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

  return <section aria-label="精选专辑轮播" tabIndex={interactionPaused ? -1 : 0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1) }} onWheel={onWheel} className="mx-auto flex w-full max-w-[1200px] flex-col items-center outline-none focus-visible:ring-4 focus-visible:ring-sky-300/50">
    <motion.div ref={stageRef} drag={interactionPaused ? false : 'x'} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.14} onDragEnd={onDragEnd} className={`relative h-[335px] w-full touch-pan-y sm:h-[330px] sm:w-[540px] lg:h-[370px] lg:w-[660px] ${interactionPaused ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}>
      {albums.map((album, index) => Math.abs(offsets[index]) <= 1 ? <MusicAlbum3DCard key={album.id} album={album} offset={offsets[index]} spacing={spacing} selected={index === selected} disabled={interactionPaused} onActivate={() => index === selected ? router.push(`/music/album/${album.id}`) : setSelected(index)} /> : null)}
    </motion.div>
    <div className="relative z-30 mt-1 flex items-center justify-center gap-3 sm:gap-4">
      <button type="button" disabled={interactionPaused} onClick={() => move(-1)} aria-label="上一张专辑" className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-xl text-white backdrop-blur-md transition hover:bg-white/[0.12] disabled:pointer-events-none">←</button>
      <button type="button" disabled={interactionPaused} onClick={() => router.push(`/music/album/${current.id}`)} className="rounded-full border border-white/[0.12] bg-white/[0.08] px-5 py-3 text-sm font-black text-white backdrop-blur-md transition hover:bg-white/[0.12] disabled:pointer-events-none sm:px-6">查看当前专辑</button>
      <button type="button" disabled={interactionPaused} onClick={() => move(1)} aria-label="下一张专辑" className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-xl text-white backdrop-blur-md transition hover:bg-white/[0.12] disabled:pointer-events-none">→</button>
    </div>
  </section>
}
