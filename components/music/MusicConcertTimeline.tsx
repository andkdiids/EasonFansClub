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

type ConcertCategory = 'main' | 'special' | 'guest'

const CATEGORY_LABELS: Record<ConcertCategory, { eyebrow: string; label: string }> = {
  main: { eyebrow: 'MAIN CONCERTS', label: '大型演唱会' },
  special: { eyebrow: 'SPECIAL PROJECTS', label: '小型企划' },
  guest: { eyebrow: 'GUEST APPEARANCES', label: '嘉宾现场' },
}

const SMALL_CONCERT_NAMES = [
  'Eason Says C’mon in Tour',
  "Eason Says C'mon in~Tour",
  'Feel Free! Feel Music!',
  'L.O.V.E is L.I.F.E',
  'Live is so much better with Music',
  'Eason and The DUO Band',
  '露天音乐会',
]

// Reserved for future front-end classification. No database field is required.
const GUEST_CONCERT_NAMES: string[] = []

function normalizeName(value: string) {
  return value.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
}

const smallConcertNameRules = SMALL_CONCERT_NAMES.map(normalizeName)
const guestConcertNameRules = GUEST_CONCERT_NAMES.map(normalizeName)

function matchesRules(tour: ConcertTimelineTour, rules: string[]) {
  const name = normalizeName(tour.name)
  return rules.some((rule) => name === rule || name.includes(rule))
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
  return <span className={`music-concert-gallery-image${square ? ' is-square' : ''}`}>
    {tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill sizes={sizes} className="object-contain" /> : <span className="music-concert-gallery-image-fallback">LIVE</span>}
  </span>
}

function OrbitPoster({ tour, hidden, onOpen, cardRef }: Readonly<{ tour: ConcertTimelineTour; hidden?: boolean; onOpen: (tour: ConcertTimelineTour) => void; cardRef: (element: HTMLElement | null) => void }>) {
  const year = formatYear(tour.startDate)
  return <article ref={cardRef} className="music-concert-gallery-poster" aria-hidden={hidden || undefined}>
    <button type="button" tabIndex={hidden ? -1 : undefined} className="music-concert-gallery-poster-button" aria-label={`展开《${tour.name}》演唱会档案`} onClick={() => onOpen(tour)}>
      <ArchivePoster tour={tour} sizes="(max-width: 767px) 132px, 220px" square />
      <span className="music-concert-gallery-year">{year}</span>
      <span className="music-concert-gallery-caption">
        <span>{year}</span>
        <strong>{tour.name}</strong>
        <small>{tour.concertCount} 场</small>
        <b>进入详情 <span aria-hidden="true">→</span></b>
      </span>
    </button>
  </article>
}

function MuseumWheel({ tours, paused, onOpen }: Readonly<{ tours: ConcertTimelineTour[]; paused: boolean; onOpen: (tour: ConcertTimelineTour) => void }>) {
  const stageRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef(new Map<number, HTMLElement>())
  const rotationRef = useRef(0)
  const frameRef = useRef(0)
  const manualPauseUntilRef = useRef(0)
  const dragRef = useRef<{ pointerId: number; startAngle: number; startRotation: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const displayedTours = tours.slice(0, 7)

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || displayedTours.length === 0) return undefined
    let previousTime = performance.now()

    const paint = (now: number) => {
      const width = stage.clientWidth
      const height = stage.clientHeight
      const mobile = window.innerWidth < 768
      const orbitCount = mobile ? Math.min(displayedTours.length, 4) : displayedTours.length
      const cardSize = cardsRef.current.get(0)?.offsetWidth || (mobile ? 112 : 220)
      const centerX = (width - cardSize) / 2
      const centerY = (height - cardSize) / 2
      const radius = Math.max(0, (Math.min(width, height) - cardSize) / 2 - (mobile ? 4 : 10))
      const delta = Math.min(48, now - previousTime)
      previousTime = now
      if (!paused && !dragRef.current && now > manualPauseUntilRef.current) {
        rotationRef.current = (rotationRef.current + delta * .003) % 360
      }

      cardsRef.current.forEach((element, index) => {
        if (index >= orbitCount) {
          element.style.opacity = '0'
          element.style.pointerEvents = 'none'
          return
        }
        const angleDegrees = rotationRef.current - 90 + index * (360 / orbitCount)
        const angle = angleDegrees * Math.PI / 180
        const cosine = Math.cos(angle)
        const sine = Math.sin(angle)
        const x = centerX + cosine * radius
        const y = centerY + sine * radius
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`
        element.style.opacity = '1'
        element.style.zIndex = '20'
        element.style.pointerEvents = ''
      })
      frameRef.current = window.requestAnimationFrame(paint)
    }

    frameRef.current = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [displayedTours.length, paused])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return undefined
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      rotationRef.current += event.deltaY * .08
      manualPauseUntilRef.current = performance.now() + 900
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const startAngle = Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)) * 180 / Math.PI
    dragRef.current = { pointerId: event.pointerId, startAngle, startRotation: rotationRef.current, moved: false }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const bounds = stageRef.current?.getBoundingClientRect()
    if (!bounds) return
    const pointerAngle = Math.atan2(event.clientY - (bounds.top + bounds.height / 2), event.clientX - (bounds.left + bounds.width / 2)) * 180 / Math.PI
    let angleDelta = pointerAngle - drag.startAngle
    if (angleDelta > 180) angleDelta -= 360
    if (angleDelta < -180) angleDelta += 360
    if (Math.abs(angleDelta) > 2 && !drag.moved) {
      drag.moved = true
      stageRef.current?.setPointerCapture(event.pointerId)
    }
    rotationRef.current = drag.startRotation + angleDelta
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

  return <div ref={stageRef} className="music-concert-gallery-wheel" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onClickCapture={(event) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }}>
    <div className="music-concert-gallery-ring" aria-hidden="true" />
    <div className="music-concert-gallery-orbit">
      {displayedTours.map((tour, index) => <OrbitPoster key={tour.id} tour={tour} hidden={false} onOpen={onOpen} cardRef={(element) => {
        if (element) cardsRef.current.set(index, element)
        else cardsRef.current.delete(index)
      }} />)}
    </div>
    {!displayedTours.length ? <p className="music-concert-gallery-empty">暂无收录</p> : null}
  </div>
}

function MyLiveCenter({ data }: Readonly<{ data?: ConcertArchiveMyLive }>) {
  return <section className="music-concert-gallery-my-live" aria-labelledby="concert-gallery-my-live-title">
    <div className="music-concert-gallery-my-live-head">
      <p>PRIVATE LIVE COLLECTION</p>
      <span aria-hidden="true">EC</span>
    </div>
    <h2 id="concert-gallery-my-live-title">MY LIVE</h2>
    <strong>我的现场收藏</strong>
    <div className="music-concert-gallery-collection-count">
      <b>{data?.attendedCount ?? '--'}</b>
      <span>观看现场数量</span>
    </div>
    <div className="music-concert-gallery-collection-details">
      <div><span>收藏巡演数量</span><b>{data?.tourCount ?? '--'}</b></div>
      <div><span>最近观看</span><b>{data?.recentConcert || '--'}</b></div>
    </div>
    <Link href="/music/live/me">进入我的现场 <span aria-hidden="true">→</span></Link>
  </section>
}

function ExpandedConcert({ tour, onClose }: Readonly<{ tour: ConcertTimelineTour; onClose: () => void }>) {
  return <div className="music-concert-gallery-modal" role="presentation" onClick={onClose}>
    <div className="music-concert-gallery-modal-panel" role="dialog" aria-modal="true" aria-labelledby="concert-gallery-modal-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="music-concert-gallery-modal-close" aria-label="关闭演唱会档案" onClick={onClose}>×</button>
      <div className="music-concert-gallery-modal-grid">
        <ArchivePoster tour={tour} sizes="(max-width: 767px) 58vw, 270px" />
        <div className="music-concert-gallery-modal-copy">
          <time>{formatYear(tour.startDate)}</time>
          <h2 id="concert-gallery-modal-title">{tour.name}</h2>
          <p className="music-concert-gallery-modal-count">{tour.concertCount} 场</p>
          <p className="music-concert-gallery-modal-description">{tour.description?.trim() || '简介暂未整理。'}</p>
          <Link href={archiveHref(tour)}>查看完整巡演详情 <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </div>
  </div>
}

export function MusicConcertTimeline({ tours, compact = false, myLive }: Readonly<{ tours: ConcertTimelineTour[]; compact?: boolean; myLive?: ConcertArchiveMyLive }>) {
  const [activeCategory, setActiveCategory] = useState<ConcertCategory>('main')
  const [switching, setSwitching] = useState(false)
  const [interactionPaused, setInteractionPaused] = useState(false)
  const [expandedTour, setExpandedTour] = useState<ConcertTimelineTour | null>(null)
  const switchTimerRef = useRef<number | null>(null)
  const guestConcerts = tours.filter((tour) => matchesRules(tour, guestConcertNameRules))
  const specialProjects = tours.filter((tour) => !matchesRules(tour, guestConcertNameRules) && matchesRules(tour, smallConcertNameRules))
  const mainConcerts = tours.filter((tour) => !matchesRules(tour, guestConcertNameRules) && !matchesRules(tour, smallConcertNameRules))
  const categoryTours: Record<ConcertCategory, ConcertTimelineTour[]> = { main: mainConcerts, special: specialProjects, guest: guestConcerts }
  const activeLabel = CATEGORY_LABELS[activeCategory]

  function selectCategory(nextCategory: ConcertCategory) {
    if (switching || nextCategory === activeCategory) return
    setSwitching(true)
    switchTimerRef.current = window.setTimeout(() => {
      setActiveCategory(nextCategory)
      window.requestAnimationFrame(() => setSwitching(false))
    }, 180)
  }

  useEffect(() => () => {
    if (switchTimerRef.current !== null) window.clearTimeout(switchTimerRef.current)
  }, [])

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

  return <section className={`music-concert-gallery${compact ? ' is-compact' : ''}`} aria-label="Eason in Concert 互动式演唱会展厅">
    <header className="music-concert-gallery-switcher">
      <p>{activeLabel.eyebrow}</p>
      <div role="tablist" aria-label="演唱会分类">
        {(Object.keys(CATEGORY_LABELS) as ConcertCategory[]).map((category) => <button key={category} type="button" role="tab" aria-selected={category === activeCategory} disabled={switching} onClick={() => selectCategory(category)}>{CATEGORY_LABELS[category].label}</button>)}
      </div>
    </header>
    <div className={`music-concert-gallery-stage${switching ? ' is-switching' : ''}`} onMouseEnter={() => setInteractionPaused(true)} onMouseLeave={() => setInteractionPaused(false)} onFocusCapture={() => setInteractionPaused(true)} onBlurCapture={() => setInteractionPaused(false)}>
      <MuseumWheel key={activeCategory} tours={categoryTours[activeCategory]} paused={Boolean(expandedTour) || switching || interactionPaused} onOpen={setExpandedTour} />
      <MyLiveCenter data={myLive} />
    </div>
    {expandedTour ? <ExpandedConcert tour={expandedTour} onClose={() => setExpandedTour(null)} /> : null}
  </section>
}
