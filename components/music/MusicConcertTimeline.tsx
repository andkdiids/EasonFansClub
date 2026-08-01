'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

function ArchivePoster({ tour, sizes, modal = false }: Readonly<{ tour: ConcertTimelineTour; sizes: string; modal?: boolean }>) {
  return <span className={`music-concert-archive-poster${modal ? ' is-modal' : ''}`}>
    {tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill sizes={sizes} className="object-contain" /> : <span className="music-concert-archive-poster-fallback">LIVE</span>}
  </span>
}

function ConcertOrbitPoster({ tour, side, duplicate, onOpen, cardRef }: Readonly<{ tour: ConcertTimelineTour; side: ConcertArchiveSide; duplicate?: boolean; onOpen: (tour: ConcertTimelineTour) => void; cardRef: (element: HTMLElement | null) => void }>) {
  const year = formatYear(tour.startDate)
  return <article ref={cardRef} className={`music-concert-orbit-poster music-concert-orbit-poster--${side}`} aria-hidden={duplicate || undefined}>
    <button type="button" tabIndex={duplicate ? -1 : undefined} className="music-concert-orbit-button" aria-label={`展开《${tour.name}》演唱会档案`} onClick={() => onOpen(tour)}>
      <ArchivePoster tour={tour} sizes="(max-width: 767px) 104px, 126px" />
      <span className="music-concert-orbit-year">{year}</span>
      <span className="music-concert-orbit-details">
        <span>{year}</span>
        <strong>{tour.name}</strong>
        <small>{tour.concertCount} 场</small>
      </span>
    </button>
  </article>
}

function ConcertOrbit({ tours, side, paused, onOpen }: Readonly<{ tours: ConcertTimelineTour[]; side: ConcertArchiveSide; paused: boolean; onOpen: (tour: ConcertTimelineTour) => void }>) {
  const isLarge = side === 'large'
  const title = isLarge ? '大型演唱会' : '小型企划'
  const viewportRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef(new Map<number, HTMLElement>())
  const travelRef = useRef(0)
  const hoverPausedRef = useRef(false)
  const frameRef = useRef(0)
  const displayedTours = tours.length > 0 && tours.length < 4 ? Array.from({ length: 4 }, (_, index) => tours[index % tours.length]) : tours

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || displayedTours.length === 0) return undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let previousTime = performance.now()

    const paint = (now: number) => {
      const width = viewport.clientWidth
      const height = viewport.clientHeight
      const mobile = window.innerWidth < 768
      const posterWidth = mobile ? (window.innerWidth < 375 ? 92 : 104) : 126
      const posterHeight = posterWidth * 4 / 3
      const spacing = mobile ? 154 : 178
      const pathLength = displayedTours.length * spacing
      const baseX = mobile ? (width - posterWidth) / 2 : isLarge ? 0 : width - posterWidth
      const direction = isLarge ? 1 : -1
      const arcDepth = mobile ? Math.min(46, width * .13) : Math.min(132, width * .36)
      const delta = Math.min(48, now - previousTime)
      previousTime = now
      if (!paused && !hoverPausedRef.current && !reduceMotion) travelRef.current = (travelRef.current + delta * .016) % pathLength

      cardsRef.current.forEach((element, index) => {
        const rawY = ((index * spacing - travelRef.current) % pathLength + pathLength) % pathLength
        const y = rawY - posterHeight
        const progress = Math.max(0, Math.min(1, (y + posterHeight) / (height + posterHeight)))
        const arc = Math.sin(progress * Math.PI)
        const x = baseX + direction * arcDepth * arc
        const edgeDistance = Math.min(progress, 1 - progress) * 2
        const opacity = Math.max(0, Math.min(1, edgeDistance * 2.4))
        const scale = .82 + arc * .18
        element.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`
        element.style.opacity = String(opacity)
        element.style.zIndex = String(Math.max(1, Math.round(10 + arc * 20)))
        element.style.pointerEvents = opacity < .18 ? 'none' : ''
      })
      frameRef.current = window.requestAnimationFrame(paint)
    }

    frameRef.current = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [displayedTours.length, isLarge, paused])

  return <section className={`music-concert-archive-column music-concert-archive-column--${side}`} aria-labelledby={`concert-archive-${side}-title`}>
    <header className="music-concert-archive-heading">
      <p>{isLarge ? 'MAIN STAGES' : 'SPECIAL PROJECTS'}</p>
      <h2 id={`concert-archive-${side}-title`}>{title}</h2>
    </header>
    {displayedTours.length ? <div ref={viewportRef} className="music-concert-archive-viewport" onMouseEnter={() => { hoverPausedRef.current = true }} onMouseLeave={() => { hoverPausedRef.current = false }} onFocusCapture={() => { hoverPausedRef.current = true }} onBlurCapture={() => { hoverPausedRef.current = false }}>
      <div className="music-concert-orbit-rail" aria-hidden="true" />
      <div className="music-concert-orbit-stage">
        {displayedTours.map((tour, index) => <ConcertOrbitPoster key={`${tour.id}-${index}`} tour={tour} side={side} duplicate={index >= tours.length} onOpen={onOpen} cardRef={(element) => {
          if (element) cardsRef.current.set(index, element)
          else cardsRef.current.delete(index)
        }} />)}
      </div>
    </div> : <p className="music-concert-archive-empty">暂无收录</p>}
  </section>
}

function MyLivePanel({ data }: Readonly<{ data?: ConcertArchiveMyLive }>) {
  const favorites = data?.favoriteConcerts?.filter(Boolean).slice(0, 3) ?? []
  return <section className="music-concert-archive-my-live" aria-labelledby="concert-archive-my-live-title">
    <div className="music-concert-archive-my-live-glow" aria-hidden="true" />
    <div className="music-concert-archive-my-live-panel">
      <p className="music-concert-archive-kicker">PERSONAL COLLECTION</p>
      <h2 id="concert-archive-my-live-title">MY LIVE</h2>
      <p className="music-concert-archive-my-live-cn">我的现场档案</p>
      <dl className="music-concert-archive-stats">
        <div><dd>{data?.attendedCount ?? '--'}</dd><dt>看过的现场</dt></div>
        <div><dd>{data?.tourCount ?? '--'}</dd><dt>看过的巡演</dt></div>
      </dl>
      <div className="music-concert-archive-recent">
        <span>RECENT LIVE</span>
        <strong>{data?.recentConcert || '--'}</strong>
      </div>
      <div className="music-concert-archive-favorites">
        <p>收藏演唱会</p>
        <ul>{favorites.length ? favorites.map((name) => <li key={name}>{name}</li>) : <li>--</li>}</ul>
      </div>
      <Link href="/music/live/me" className="music-concert-archive-my-live-link">进入我的现场 <span aria-hidden="true">→</span></Link>
    </div>
  </section>
}

function ExpandedConcert({ tour, onClose }: Readonly<{ tour: ConcertTimelineTour; onClose: () => void }>) {
  return <div className="music-concert-archive-modal" role="presentation" onClick={onClose}>
    <div className="music-concert-archive-modal-panel" role="dialog" aria-modal="true" aria-labelledby="concert-archive-modal-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="music-concert-archive-modal-close" aria-label="关闭演唱会档案" onClick={onClose}>×</button>
      <div className="music-concert-archive-modal-grid">
        <ArchivePoster tour={tour} sizes="(max-width: 767px) 58vw, 270px" modal />
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
  const largeConcerts = tours.filter((tour) => !isSmallConcert(tour))
  const smallConcerts = tours.filter(isSmallConcert)

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

  return <section className={`music-concert-archive${compact ? ' is-compact' : ''}`} aria-label="Eason in Concert 互动式演唱会博物馆">
    <div className="music-concert-archive-layout">
      <ConcertOrbit tours={largeConcerts} side="large" paused={Boolean(expandedTour)} onOpen={setExpandedTour} />
      <MyLivePanel data={myLive} />
      <ConcertOrbit tours={smallConcerts} side="small" paused={Boolean(expandedTour)} onOpen={setExpandedTour} />
    </div>
    {expandedTour ? <ExpandedConcert tour={expandedTour} onClose={() => setExpandedTour(null)} /> : null}
  </section>
}
