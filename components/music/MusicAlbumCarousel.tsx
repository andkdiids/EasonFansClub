'use client'

import { motion, type PanInfo } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MusicAlbum3DCard, type MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'

export function MusicAlbumCarousel({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  const router = useRouter()
  const [selected, setSelected] = useState(0)
  const [layout, setLayout] = useState({ spacing: 220, radius: 2 })
  const wheelLock = useRef(0)

  const move = useCallback((direction: number) => {
    setSelected((current) => albums.length ? (current + direction + albums.length) % albums.length : 0)
  }, [albums.length])

  useEffect(() => {
    const resize = () => {
      if (window.innerWidth < 640) setLayout({ spacing: 205, radius: 1 })
      else if (window.innerWidth < 1024) setLayout({ spacing: 205, radius: 1 })
      else setLayout({ spacing: 225, radius: 2 })
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const offsets = useMemo(() => albums.map((_, index) => {
    let value = index - selected
    if (value > albums.length / 2) value -= albums.length
    if (value < -albums.length / 2) value += albums.length
    return value
  }), [albums, selected])

  function onWheel(event: React.WheelEvent) {
    event.preventDefault()
    const now = Date.now()
    if (now - wheelLock.current < 320 || Math.abs(event.deltaY) < 8) return
    wheelLock.current = now
    move(event.deltaY > 0 ? 1 : -1)
  }

  function onDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    if (Math.abs(info.offset.x) > 45 || Math.abs(info.velocity.x) > 350) move(info.offset.x < 0 ? 1 : -1)
  }

  if (albums.length === 0) {
    return <div className="grid min-h-[360px] place-items-center rounded-[28px] border border-white/10 bg-white/[0.04] p-8 text-center text-sm font-bold text-white/65">暂无已发布专辑。管理员发布专辑后会自动出现在这里。</div>
  }

  const current = albums[selected]

  return (
    <section
      aria-label="精选专辑轮播"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') move(-1)
        if (event.key === 'ArrowRight') move(1)
      }}
      onWheel={onWheel}
      className="relative outline-none focus-visible:ring-4 focus-visible:ring-sky-300/70"
    >
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.16}
        onDragEnd={onDragEnd}
        className="relative h-[360px] cursor-grab touch-pan-y active:cursor-grabbing sm:h-[350px] lg:h-[390px]"
      >
        {albums.map((album, index) => Math.abs(offsets[index]) <= layout.radius ? (
          <MusicAlbum3DCard
            key={album.id}
            album={album}
            offset={offsets[index]}
            spacing={layout.spacing}
            selected={index === selected}
            onActivate={() => index === selected ? router.push(`/music/album/${album.id}`) : setSelected(index)}
          />
        ) : null)}
      </motion.div>

      <div className="relative z-30 mt-2 flex items-center justify-center gap-4">
        <button type="button" onClick={() => move(-1)} aria-label="上一张专辑" className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.08] text-xl text-white backdrop-blur-md transition hover:border-sky-300/40 hover:bg-white/15">←</button>
        <button type="button" onClick={() => router.push(`/music/album/${current.id}`)} className="rounded-full border border-white/15 bg-white/[0.1] px-6 py-3 text-sm font-black text-white backdrop-blur-md transition hover:border-sky-300/40 hover:bg-white/15">查看当前专辑</button>
        <button type="button" onClick={() => move(1)} aria-label="下一张专辑" className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.08] text-xl text-white backdrop-blur-md transition hover:border-sky-300/40 hover:bg-white/15">→</button>
      </div>
    </section>
  )
}
