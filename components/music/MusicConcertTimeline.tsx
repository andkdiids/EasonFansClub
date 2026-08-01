'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { generateArchiveSlug } from '@/lib/music-slug'

export type ConcertTimelineTour = {
  id: string
  name: string
  subtitle?: string | null
  description?: string | null
  posterUrl?: string | null
  startDate?: Date | string | null
  endDate?: Date | string | null
  concertCount: number
  cities?: string[]
}

export type ConcertArchiveMyLive = {
  attendedCount?: number | null
  tourCount?: number | null
  recentConcert?: string | null
  favoriteConcerts?: string[]
}

type ConcertArchiveSide = 'large' | 'small'

const SMALL_CONCERT_NAMES = [
  'Eason Says C’mon in Tour',
  "Eason Says C'mon in~Tour",
  'Feel Free! Feel Music!',
  'L.O.V.E is L.I.F.E',
  'Live is so much better with Music',
  'Eason and The DUO Band',
  '露天音乐会',
]

function normalizeName(value: string) {
  return value.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
}

const smallConcertNameRules = SMALL_CONCERT_NAMES.map(normalizeName)

function isSmallConcert(tour: ConcertTimelineTour) {
  const name = normalizeName(tour.name)
  return smallConcertNameRules.some((rule) => name === rule || name.includes(rule))
}

function formatYear(value: Date | string | null | undefined) {
  if (!value) return 'ARCHIVE'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'ARCHIVE' : String(date.getUTCFullYear())
}

function archiveHref(tour: ConcertTimelineTour) {
  return `/music/live/tours/${generateArchiveSlug(tour.name)}`
}

function ArchivePoster({ tour, sizes, square = false }: Readonly<{ tour: ConcertTimelineTour; sizes: string; square?: boolean }>) {
  return <span className={`music-concert-archive-poster${square ? ' is-square' : ''}`}>
    {tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill sizes={sizes} className={square ? 'object-cover' : 'object-contain'} /> : <span className="music-concert-archive-poster-fallback">LIVE</span>}
  </span>
}

function MuseumPoster({ tour, side, duplicate, onOpen, cardRef }: Readonly<{ tour: ConcertTimelineTour; side: ConcertArchiveSide; duplicate?: boolean; onOpen: (tour: ConcertTimelineTour) => void; cardRef: (element: HTMLElement | null) => void }>) {
  const year = formatYear(tour.startDate)
  return <article ref={cardRef} className={`music-concert-museum-poster music-concert-museum-poster--${side}`} aria-hidden={duplicate || undefined}>
    <button type="button" tabIndex={duplicate ? -1 : undefined} className="music-concert-museum-poster-button" aria-label={`展开《${tour.name}》演唱会档案`} onClick={() => onOpen(tour)}>
      <ArchivePoster tour={tour} sizes="(max-width: 767px) 150px, 220px" square />
      <span className="music-concert-museum-year">{year}</span>
      <span className="music-concert-museum-caption">
        <span>{year}</span>
        <strong>{tour.name}</strong>
        <small>{tour.concertCount} 场</small>
      </span>
    </button>
  </article>
}

function MuseumCarousel({ tours, side, paused, onOpen }: Readonly<{ tours: ConcertTimelineTour[]; side: ConcertArchiveSide; paused: boolean; onOpen: (tour: ConcertTimelineTour) => void }>) {
  const isLarge = side === 'large'
  const displayedTours = tours.length > 0 && tours.length < 4 ? Array.from({ length: 4 }, (_, index) => tours[index % tours.length]) : tours
  const viewportRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef(new Map<number, HTMLElement>())
  const positionRef = useRef(0)
  const frameRef = useRef(0)
  const hoverPausedRef = useRef(false)
  const manualPauseUntilRef = useRef(0)
  const dragRef = useRef<{ pointerId: number; startY: number; startPosition: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || displayedTours.length === 0) return undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let previousTime = performance.now()

    const paint = (now: number) => {
      const width = viewport.clientWidth
      const height = viewport.clientHeight
      const cardSize = cardsRef.current.get(0)?.offsetWidth || (window.innerWidth < 768 ? 136 : 200)
      const spacing = cardSize * 1.18
      const pathLength = displayedTours.length * spacing
      const baseX = isLarge ? 4 : width - cardSize - 4
      const direction = isLarge ? 1 : -1
      const arcDepth = Math.min(width * (window.innerWidth < 768 ? .28 : .38), window.innerWidth < 768 ? 88 : 150)
      const delta = Math.min(48, now - previousTime)
      previousTime = now
      if (!paused && !hoverPausedRef.current && !dragRef.current && now > manualPauseUntilRef.current && !reduceMotion) {
        positionRef.current = (positionRef.current + delta * .014) % pathLength
      }

      cardsRef.current.forEach((element, index) => {
        const rawY = ((index * spacing + positionRef.current) % pathLength + pathLength) % pathLength
        const y = rawY - cardSize
        const progress = Math.max(0, Math.min(1, (y + cardSize) / (height + cardSize)))
        const arc = Math.sin(progress * Math.PI)
        const x = baseX + direction * arcDepth * arc
        const edgeDistance = Math.min(progress, 1 - progress) * 2
        const opacity = Math.max(0, Math.min(1, edgeDistance * 2.7))
        const scale = .78 + arc * .22
        element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
        element.style.opacity = String(opacity)
        element.style.zIndex = String(Math.max(1, Math.round(10 + arc * 20)))
        element.style.pointerEvents = opacity < .16 ? 'none' : ''
      })
      frameRef.current = window.requestAnimationFrame(paint)
    }

    frameRef.current = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [displayedTours.length, isLarge, paused])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      positionRef.current += event.deltaY * .72
      manualPauseUntilRef.current = performance.now() + 900
    }
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY, startPosition: positionRef.current, moved: false }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaY = event.clientY - drag.startY
    if (Math.abs(deltaY) > 6 && !drag.moved) {
      drag.moved = true
      viewportRef.current?.setPointerCapture(event.pointerId)
    }
    positionRef.current = drag.startPosition + deltaY
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.moved) {
      suppressClickRef.current = true
      window.requestAnimationFrame(() => { suppressClickRef.current = false })
    }
    dragRef.current = null
    manualPauseUntilRef.current = performance.now() + 700
  }

  return <section className={`music-concert-museum-side music-concert-museum-side--${side}`} aria-labelledby={`concert-museum-${side}-title`}>
    <header className="music-concert-museum-heading">
      <p>{isLarge ? 'MAIN CONCERTS' : 'SPECIAL PROJECTS'}</p>
      <h2 id={`concert-museum-${side}-title`}>{isLarge ? '大型演唱会' : '小型企划'}</h2>
    </header>
    {displayedTours.length ? <div ref={viewportRef} className="music-concert-museum-viewport" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onClickCapture={(event) => {
      if (!suppressClickRef.current) return
      event.preventDefault()
      event.stopPropagation()
    }} onMouseEnter={() => { hoverPausedRef.current = true }} onMouseLeave={() => { hoverPausedRef.current = false }} onFocusCapture={() => { hoverPausedRef.current = true }} onBlurCapture={() => { hoverPausedRef.current = false }}>
      <div className="music-concert-museum-arc" aria-hidden="true" />
      <div className="music-concert-museum-stage">
        {displayedTours.map((tour, index) => <MuseumPoster key={`${tour.id}-${index}`} tour={tour} side={side} duplicate={index >= tours.length} onOpen={onOpen} cardRef={(element) => {
          if (element) cardsRef.current.set(index, element)
          else cardsRef.current.delete(index)
        }} />)}
      </div>
      <p className="music-concert-museum-interaction-hint" aria-hidden="true">SCROLL / DRAG</p>
    </div> : <p className="music-concert-archive-empty">暂无收录</p>}
  </section>
}

function MyLiveShowcase({ data }: Readonly<{ data?: ConcertArchiveMyLive }>) {
  const favorites = data?.favoriteConcerts?.filter(Boolean).slice(0, 3) ?? []
  return <section className="music-concert-my-live" aria-labelledby="concert-museum-my-live-title">
    <div className="music-concert-my-live-halo" aria-hidden="true" />
    <div className="music-concert-my-live-showcase">
      <p className="music-concert-archive-kicker">PRIVATE LIVE COLLECTION</p>
      <h2 id="concert-museum-my-live-title">MY LIVE</h2>
      <p className="music-concert-my-live-subtitle">我的现场收藏</p>
      <dl className="music-concert-my-live-numbers">
        <div><dd>{data?.attendedCount ?? '--'}</dd><dt>观看总场数</dt></div>
        <div><dd>{data?.tourCount ?? '--'}</dd><dt>观看巡演</dt></div>
      </dl>
      <div className="music-concert-my-live-memory">
        <span>最近观看</span>
        <strong>{data?.recentConcert || '--'}</strong>
      </div>
      <div className="music-concert-my-live-collection">
        <span>收藏演唱会</span>
        <ul>{favorites.length ? favorites.map((name) => <li key={name}>{name}</li>) : <li>--</li>}</ul>
      </div>
      <Link href="/music/live/me" className="music-concert-my-live-link">进入我的现场 <span aria-hidden="true">→</span></Link>
    </div>
  </section>
}

function ExpandedConcert({ tour, onClose }: Readonly<{ tour: ConcertTimelineTour; onClose: () => void }>) {
  return <div className="music-concert-archive-modal" role="presentation" onClick={onClose}>
    <div className="music-concert-archive-modal-panel" role="dialog" aria-modal="true" aria-labelledby="concert-archive-modal-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="music-concert-archive-modal-close" aria-label="关闭演唱会档案" onClick={onClose}>×</button>
      <div className="music-concert-archive-modal-grid">
        <ArchivePoster tour={tour} sizes="(max-width: 767px) 58vw, 270px" />
        <div className="music-concert-archive-modal-copy">
          <time>{formatYear(tour.startDate)}</time>
          <h2 id="concert-archive-modal-title">{tour.name}</h2>
          <p className="music-concert-archive-modal-count">{tour.concertCount} 场</p>
          <p className="music-concert-archive-modal-description">{tour.description?.trim() || '简介暂未整理。'}</p>
          <Link href={archiveHref(tour)} className="music-concert-archive-modal-link" onClick={(event) => event.stopPropagation()}>查看完整巡演详情 <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </div>
  </div>
}

export function MusicConcertTimeline({ tours, compact = false, myLive }: Readonly<{ tours: ConcertTimelineTour[]; compact?: boolean; myLive?: ConcertArchiveMyLive }>) {
  const [expandedTour, setExpandedTour] = useState<ConcertTimelineTour | null>(null)
  const mainConcerts = tours.filter((tour) => !isSmallConcert(tour))
  const specialProjects = tours.filter(isSmallConcert)

  useEffect(() => {
    if (!expandedTour) return undefined
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpandedTour(null)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [expandedTour])

  return <section className={`music-concert-museum${compact ? ' is-compact' : ''}`} aria-label="Eason in Concert 互动式演唱会博物馆">
    <div className="music-concert-museum-layout">
      <MuseumCarousel tours={mainConcerts} side="large" paused={Boolean(expandedTour)} onOpen={setExpandedTour} />
      <MyLiveShowcase data={myLive} />
      <MuseumCarousel tours={specialProjects} side="small" paused={Boolean(expandedTour)} onOpen={setExpandedTour} />
    </div>
    {expandedTour ? <ExpandedConcert tour={expandedTour} onClose={() => setExpandedTour(null)} /> : null}
  </section>
}
