'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MusicAlbum3DCard, type MusicCarouselAlbum } from '@/components/music/MusicAlbum3DCard'
import { getWrappedOffset, normalizeIndex, normalizePosition } from '@/lib/music-carousel'
import { formatTrackCount } from '@/lib/music-display'

const TRANSITION_MS = 320
const SWIPE_DISTANCE = 45
const SWIPE_VELOCITY = 350

// 与 CSS cubic-bezier(0.22, 1, 0.36, 1) 完全一致的三次贝塞尔缓动求解器
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const sampleDerivativeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(t) - x
      if (Math.abs(error) < 1e-6) return sampleY(t)
      const derivative = sampleDerivativeX(t)
      if (Math.abs(derivative) < 1e-6) break
      t -= error / derivative
    }
    let low = 0
    let high = 1
    while (high - low > 1e-6) {
      t = (high + low) / 2
      if (sampleX(t) > x) high = t
      else low = t
    }
    return sampleY(t)
  }
}

const ease = cubicBezier(0.22, 1, 0.36, 1)
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function MusicAlbumCarousel({ albums }: Readonly<{ albums: MusicCarouselAlbum[] }>) {
  const router = useRouter()
  const stageRef = useRef<HTMLDivElement>(null)
  const wheelLock = useRef(0)
  const [selected, setSelected] = useState(0)
  const [layout, setLayout] = useState({ cardWidth: 238, spacing: 152, visibleRange: 1 })
  const [interactionPaused, setInteractionPaused] = useState(false)
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const frameRef = useRef(0)
  const positionRef = useRef(0)
  const targetRef = useRef(0)
  const layoutRef = useRef(layout)
  const pausedRef = useRef(interactionPaused)
  const dragRef = useRef<{ pointerId: number; startX: number; startPos: number; moved: boolean; clickedIndex: number | null; samples: { x: number; t: number }[] } | null>(null)
  const suppressClickRef = useRef(false)

  // 每一帧只写 transform/opacity/zIndex,不经过 React render;offset 一律走循环最短距离
  const paint = useCallback((position: number) => {
    const count = albums.length
    if (count === 0) return
    const { spacing, visibleRange } = layoutRef.current
    cardRefs.current.forEach((element, index) => {
      const offset = getWrappedOffset(index, position, count)
      const distance = Math.abs(offset)
      const blend = Math.min(distance, 1)
      const scale = 1 - 0.1 * blend
      let opacity = 1 - 0.24 * blend
      if (distance > visibleRange) opacity *= Math.max(0, 1 - (distance - visibleRange))
      // 两段 translate3d 叠加实现 -50% 居中 + 位移,避免 calc() 负数在 WebKit 下失效
      element.style.transform = `translate3d(${offset * spacing}px, ${-3 + 6 * blend}px, 0) translate3d(-50%, 0, 0) scale(${scale})`
      element.style.opacity = String(opacity)
      element.style.zIndex = String(distance < 0.5 ? 30 : Math.max(1, Math.round(12 - distance)))
      element.style.pointerEvents = opacity < 0.05 ? 'none' : ''
      const button = element.firstElementChild as HTMLButtonElement | null
      if (button) button.tabIndex = opacity < 0.05 ? -1 : 0
    })
  }, [albums.length])
  const paintRef = useRef(paint)

  useIsoLayoutEffect(() => {
    layoutRef.current = layout
    pausedRef.current = interactionPaused
    paintRef.current = paint
    paint(positionRef.current)
  })

  const cancelFrame = useCallback(() => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
  }, [])
  useEffect(() => cancelFrame, [cancelFrame])

  const animateTo = useCallback((target: number) => {
    const count = albums.length
    if (count < 2) return
    // 所有入口(按钮/滚轮/键盘/拖动结束)统一走这套索引归一化
    const normalized = normalizeIndex(target, count)
    targetRef.current = normalized
    setSelected(normalized)
    // 动画目标使用连续位置并走最短路径:最后一张->第一张继续向右滑一张,不横跨数组
    let destination = target
    while (destination - positionRef.current > count / 2) destination -= count
    while (destination - positionRef.current < -count / 2) destination += count
    cancelFrame()
    const from = positionRef.current
    const distance = destination - from
    if (Math.abs(distance) < 0.001) {
      positionRef.current = normalizePosition(destination, count)
      paintRef.current(positionRef.current)
      return
    }
    const startedAt = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / TRANSITION_MS)
      positionRef.current = from + distance * ease(progress)
      if (progress < 1) {
        paintRef.current(positionRef.current)
        frameRef.current = requestAnimationFrame(step)
        return
      }
      frameRef.current = 0
      // 动画完成后才归一化 positionRef;wrapped offset 不变,无视觉跳变
      positionRef.current = normalizePosition(destination, count)
      paintRef.current(positionRef.current)
    }
    frameRef.current = requestAnimationFrame(step)
  }, [albums.length, cancelFrame])

  const move = useCallback((direction: number) => {
    if (pausedRef.current) return
    animateTo(targetRef.current + direction)
  }, [animateTo])

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

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (pausedRef.current || albums.length < 2) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    cancelFrame()
    const card = (event.target as HTMLElement).closest<HTMLElement>('[data-carousel-index]')
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startPos: positionRef.current, moved: false, clickedIndex: card ? Number(card.dataset.carouselIndex) : null, samples: [{ x: event.clientX, t: performance.now() }] }
    stageRef.current?.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const deltaX = event.clientX - drag.startX
    if (Math.abs(deltaX) > 6) drag.moved = true
    // 拖动过程卡片跟手:位置 = 起始位置 - 拖动距离 / 间距,按 rAF 节拍写入
    positionRef.current = drag.startPos - deltaX / layoutRef.current.spacing
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      if (dragRef.current) paintRef.current(positionRef.current)
    })
    const now = performance.now()
    drag.samples.push({ x: event.clientX, t: now })
    while (drag.samples.length > 2 && now - drag.samples[0].t > 120) drag.samples.shift()
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    if (albums.length === 0) return
    if (!cancelled && !drag.moved && drag.clickedIndex !== null) {
      suppressClickRef.current = true
      if (drag.clickedIndex === selected) router.push(`/music/album/${albums[drag.clickedIndex].id}`)
      else animateTo(drag.clickedIndex)
      return
    }
    if (drag.moved) suppressClickRef.current = true
    const deltaX = event.clientX - drag.startX
    const samples = drag.samples
    const first = samples[0]
    const last = samples[samples.length - 1]
    const velocity = last.t > first.t ? ((last.x - first.x) / (last.t - first.t)) * 1000 : 0
    const startIndex = Math.round(drag.startPos)
    // 惯性:根据速度 + 距离决定是前进/后退一张,还是回弹到原位
    const target = !cancelled && (Math.abs(deltaX) > SWIPE_DISTANCE || Math.abs(velocity) > SWIPE_VELOCITY) ? startIndex + (deltaX < 0 ? 1 : -1) : startIndex
    animateTo(target)
  }

  function onClickCapture(event: React.SyntheticEvent) {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  if (albums.length === 0) return <div className="mx-auto grid min-h-[320px] w-full max-w-[660px] place-items-center rounded-[24px] border border-white/10 bg-white/[0.04] p-8 text-center text-sm font-bold text-white/65">暂无已发布专辑。管理员发布专辑后会自动出现在这里。</div>
  const current = albums[selected]

  return <section aria-label="精选专辑轮播" tabIndex={interactionPaused ? -1 : 0} onKeyDown={(event) => { if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1) }} onWheel={onWheel} className="relative isolate z-0 mx-auto flex w-full max-w-7xl flex-col items-center outline-none focus-visible:ring-4 focus-visible:ring-sky-300/50">
    <div className="relative flex w-full justify-center">
      <button type="button" disabled={interactionPaused || albums.length < 2} onClick={() => move(-1)} aria-label="上一张专辑" className="absolute left-0 top-[112px] z-20 hidden size-[52px] -translate-y-1/2 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-2xl text-white shadow-lg shadow-transparent backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-white/[0.12] hover:shadow-sky-950/25 disabled:pointer-events-none md:grid lg:top-[132px]">‹</button>
      <div ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(event) => finishDrag(event, false)} onPointerCancel={(event) => finishDrag(event, true)} onClickCapture={onClickCapture} onDragStart={(event) => event.preventDefault()} className={`relative isolate h-[250px] w-full touch-pan-y select-none sm:h-[280px] md:h-[330px] md:w-[calc(100%-144px)] lg:h-[340px] xl:w-[calc(100%-160px)] ${interactionPaused ? 'pointer-events-none' : 'cursor-grab active:cursor-grabbing'}`}>
        {albums.map((album, index) => Math.abs(offsets[index]) <= layout.visibleRange + 1 ? <MusicAlbum3DCard key={album.id} album={album} carouselIndex={index} offset={offsets[index]} spacing={layout.spacing} cardWidth={layout.cardWidth} selected={index === selected} disabled={interactionPaused} onActivate={() => index === selected ? router.push(`/music/album/${album.id}`) : animateTo(index)} cardRef={(element) => { if (element) cardRefs.current.set(index, element); else cardRefs.current.delete(index) }} /> : null)}
      </div>
      <button type="button" disabled={interactionPaused || albums.length < 2} onClick={() => move(1)} aria-label="下一张专辑" className="absolute right-0 top-[112px] z-20 hidden size-[52px] -translate-y-1/2 place-items-center rounded-full border border-white/[0.12] bg-white/[0.08] text-2xl text-white shadow-lg shadow-transparent backdrop-blur-md transition duration-200 hover:scale-105 hover:bg-white/[0.12] hover:shadow-sky-950/25 disabled:pointer-events-none md:grid lg:top-[132px]">›</button>
    </div>
    <div className="mb-4 text-center text-white md:hidden"><p className="line-clamp-1 text-base font-black">《{current.name}》</p><p className="mt-1 text-xs font-bold text-slate-300/65">{current.releaseLabel} · {current.language} · {formatTrackCount(current.songCount)}</p></div>
  </section>
}
