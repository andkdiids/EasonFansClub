'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
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

function ConcertArchiveCard({ tour, side, duplicate, onOpen }: Readonly<{ tour: ConcertTimelineTour; side: ConcertArchiveSide; duplicate?: boolean; onOpen: (tour: ConcertTimelineTour) => void }>) {
  return <article className={`music-concert-archive-card music-concert-archive-card--${side}`} aria-hidden={duplicate || undefined}>
    <button type="button" tabIndex={duplicate ? -1 : undefined} className="music-concert-archive-card-button" aria-label={`展开《${tour.name}》演唱会档案`} onClick={() => onOpen(tour)}>
      <ArchivePoster tour={tour} sizes="(max-width: 767px) 104px, 132px" />
      <span className="music-concert-archive-card-copy">
        <span className="music-concert-archive-card-year">{formatYear(tour.startDate)}</span>
        <strong>{tour.name}</strong>
        <span className="music-concert-archive-card-meta">{tour.concertCount} 场 · CONCERT ARCHIVE</span>
      </span>
    </button>
  </article>
}

function ConcertArchiveCarousel({ tours, side, onOpen }: Readonly<{ tours: ConcertTimelineTour[]; side: ConcertArchiveSide; onOpen: (tour: ConcertTimelineTour) => void }>) {
  const isLarge = side === 'large'
  const title = isLarge ? '大型演唱会' : '小型企划'
  const repeatedTours = useMemo(() => {
    if (tours.length === 0 || tours.length >= 3) return tours
    return Array.from({ length: 3 }, (_, index) => tours[index % tours.length])
  }, [tours])

  return <section className={`music-concert-archive-column music-concert-archive-column--${side}`} aria-labelledby={`concert-archive-${side}-title`}>
    <header className="music-concert-archive-heading">
      <p>{isLarge ? 'MAIN STAGES' : 'SPECIAL PROJECTS'}</p>
      <h2 id={`concert-archive-${side}-title`}>{title}</h2>
    </header>
    {repeatedTours.length ? <div className="music-concert-archive-viewport">
      <div className="music-concert-archive-track">
        {[false, true].map((duplicate) => <div key={duplicate ? 'duplicate' : 'original'} className="music-concert-archive-set" aria-hidden={duplicate || undefined}>
          {repeatedTours.map((tour, index) => <ConcertArchiveCard key={`${tour.id}-${index}-${duplicate ? 'copy' : 'source'}`} tour={tour} side={side} duplicate={duplicate || index >= tours.length} onOpen={onOpen} />)}
        </div>)}
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

  return <section className={`music-concert-archive${compact ? ' is-compact' : ''}`} aria-label="Eason in Concert 互动式演唱会档案">
    <div className="music-concert-archive-layout">
      <ConcertArchiveCarousel tours={largeConcerts} side="large" onOpen={setExpandedTour} />
      <MyLivePanel data={myLive} />
      <ConcertArchiveCarousel tours={smallConcerts} side="small" onOpen={setExpandedTour} />
    </div>
    {expandedTour ? <ExpandedConcert tour={expandedTour} onClose={() => setExpandedTour(null)} /> : null}
  </section>
}
