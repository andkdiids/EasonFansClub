'use client'

import { motion, type PanInfo } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MusicAlbum3DCard, type MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'

export function MusicAlbumCarousel({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  const router = useRouter()
  const [selected, setSelected] = useState(0)
  const [spacing, setSpacing] = useState(210)
  const wheelLock = useRef(0)
  const move = useCallback((direction: number) => setSelected((current) => albums.length ? (current + direction + albums.length) % albums.length : 0), [albums.length])
  useEffect(() => { const resize = () => setSpacing(window.innerWidth < 640 ? 122 : window.innerWidth < 900 ? 170 : 220); resize(); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  const offsets = useMemo(() => albums.map((_, index) => { let value = index - selected; if (value > albums.length / 2) value -= albums.length; if (value < -albums.length / 2) value += albums.length; return value }), [albums, selected])
  function onWheel(event: React.WheelEvent) { event.preventDefault(); const now = Date.now(); if (now - wheelLock.current < 320 || Math.abs(event.deltaY) < 8) return; wheelLock.current = now; move(event.deltaY > 0 ? 1 : -1) }
  function onDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) { if (Math.abs(info.offset.x) > 45 || Math.abs(info.velocity.x) > 350) move(info.offset.x < 0 ? 1 : -1) }
  if (albums.length === 0) return <div className="grid min-h-[420px] place-items-center rounded-[36px] border border-white/10 bg-white/5 p-8 text-center text-sm font-bold text-white/65">暂无已发布专辑。管理员发布专辑后会自动出现在这里。</div>
  const current = albums[selected]
  return <section tabIndex={0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1) }} onWheel={onWheel} className="relative overflow-hidden rounded-[38px] border border-white/10 bg-[radial-gradient(circle_at_50%_35%,rgba(56,189,248,0.22),transparent_34%),linear-gradient(145deg,#06131e,#0a2940_55%,#071722)] px-3 py-8 shadow-2xl outline-none focus-visible:ring-4 focus-visible:ring-sky-300 sm:py-12">
    <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.04)_1px,transparent_1px)] [background-size:42px_42px]" />
    <motion.div drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.18} onDragEnd={onDragEnd} className="relative h-[390px] cursor-grab touch-pan-y active:cursor-grabbing sm:h-[430px]" style={{ perspective: 1200 }}>
      {albums.map((album, index) => Math.abs(offsets[index]) <= 3 ? <MusicAlbum3DCard key={album.id} album={album} offset={offsets[index]} spacing={spacing} selected={index === selected} onActivate={() => index === selected ? router.push(`/music/album/${album.id}`) : setSelected(index)} /> : null)}
    </motion.div>
    <div className="relative z-30 mx-auto mt-2 max-w-xl text-center text-white"><p className="text-xs font-black tracking-[0.2em] text-sky-300">CURRENT ALBUM</p><h2 className="mt-2 truncate text-3xl font-black sm:text-4xl">{current.name}</h2><p className="mt-2 text-sm font-bold text-white/60">{current.artist} · {current.releaseYear} · {current.language}</p><div className="mt-5 flex justify-center gap-3"><button type="button" onClick={() => move(-1)} className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10 font-black">←</button><button type="button" onClick={() => router.push(`/music/album/${current.id}`)} className="rounded-full bg-white px-5 py-2 text-sm font-black text-brand-950">查看专辑</button><button type="button" onClick={() => move(1)} className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10 font-black">→</button></div></div>
  </section>
}
