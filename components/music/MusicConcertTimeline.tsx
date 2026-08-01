'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
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

type ConcertArchiveWallSide = 'large' | 'small'

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

function ArchivePoster({ tour, sizes }: Readonly<{ tour: ConcertTimelineTour; sizes: string }>) {
  return <div className="music-concert-wall-poster">
    {tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill sizes={sizes} className="object-contain" /> : <span>LIVE</span>}
  </div>
}

function ArchiveCard({ tour, side, compact, clone, onOpen }: Readonly<{ tour: ConcertTimelineTour; side: ConcertArchiveWallSide; compact: boolean; clone?: boolean; onOpen: (tour: ConcertTimelineTour) => void }>) {
  return <article className={`music-concert-wall-card music-concert-wall-card--${side}${clone ? ' is-clone' : ''}`} aria-hidden={clone || undefined}>
    <button type="button" tabIndex={clone ? -1 : undefined} className="music-concert-wall-card-button" aria-label={`展开${tour.name}档案`} onClick={() => onOpen(tour)}>
      <ArchivePoster tour={tour} sizes={compact ? '(max-width: 767px) 82px, 72px' : '(max-width: 767px) 92px, 104px'} />
      <div className="music-concert-wall-card-body">
        <time dateTime={tour.startDate ? new Date(tour.startDate).toISOString() : undefined}>{formatYear(tour.startDate)}</time>
        <h3>{tour.name}</h3>
        <p>{tour.concertCount} 场</p>
        <span className="music-concert-wall-card-hint">查看档案 <span aria-hidden="true">↗</span></span>
      </div>
    </button>
  </article>
}

function ConcertArchiveWall({ tours, side, compact, onOpen }: Readonly<{ tours: ConcertTimelineTour[]; side: ConcertArchiveWallSide; compact: boolean; onOpen: (tour: ConcertTimelineTour) => void }>) {
  const isLarge = side === 'large'
  const title = isLarge ? '大型演唱会' : '小型企划'
  const eyebrow = isLarge ? 'MAIN STAGES' : 'SPECIAL STAGES'

  return <section className={`music-concert-wall-section music-concert-wall-section--${side}`} aria-labelledby={`music-concert-wall-${side}-title`}>
    <header className="music-concert-wall-heading">
      <p>{eyebrow}</p>
      <h2 id={`music-concert-wall-${side}-title`}>{title}</h2>
    </header>
    {tours.length ? <div className="music-concert-wall" data-wall-side={side}>
      <div className="music-concert-wall-track">
        <div className="music-concert-wall-group">
          {tours.map((tour) => <ArchiveCard key={tour.id} tour={tour} side={side} compact={compact} onOpen={onOpen} />)}
        </div>
        <div className="music-concert-wall-group" aria-hidden="true">
          {tours.map((tour) => <ArchiveCard key={`${tour.id}-clone`} tour={tour} side={side} compact={compact} clone onOpen={onOpen} />)}
        </div>
      </div>
    </div> : <p className="music-concert-wall-empty">暂无收录</p>}
  </section>
}

function MyLivePanel({ tours }: Readonly<{ tours: ConcertTimelineTour[] }>) {
  return <section className="music-concert-wall-my-live" aria-labelledby="music-concert-wall-my-live-title">
    <div className="music-concert-wall-my-live-panel">
      <p className="music-concert-wall-my-live-eyebrow">PERSONAL ARCHIVE</p>
      <h2 id="music-concert-wall-my-live-title">MY LIVE</h2>
      <p className="music-concert-wall-my-live-title">我的现场</p>
      <dl className="music-concert-wall-stats">
        <div><dd>--</dd><dt>场现场</dt></div>
        <div><dd>--</dd><dt>个巡演</dt></div>
      </dl>
      <div className="music-concert-wall-recent">
        <span>最近现场</span>
        <strong>--</strong>
      </div>
      <div className="music-concert-wall-register">
        <p>TOUR REGISTER</p>
        <ul>
          {tours.slice(0, 4).map((tour) => <li key={tour.id}>{tour.name}</li>)}
          {!tours.length ? <li>--</li> : null}
        </ul>
      </div>
      <Link href="/music/live/me" className="music-concert-wall-my-live-link">进入我的现场 <span aria-hidden="true">→</span></Link>
    </div>
  </section>
}

function ExpandedConcert({ tour, onClose }: Readonly<{ tour: ConcertTimelineTour; onClose: () => void }>) {
  return <div className="music-concert-wall-modal" role="presentation" onClick={onClose}>
    <div className="music-concert-wall-modal-panel" role="dialog" aria-modal="true" aria-labelledby="music-concert-wall-modal-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="music-concert-wall-modal-close" aria-label="关闭演唱会档案" onClick={onClose}>×</button>
      <div className="music-concert-wall-modal-grid">
        <ArchivePoster tour={tour} sizes="(max-width: 767px) 45vw, 260px" />
        <div className="music-concert-wall-modal-body">
          <time dateTime={tour.startDate ? new Date(tour.startDate).toISOString() : undefined}>{formatYear(tour.startDate)}</time>
          <h2 id="music-concert-wall-modal-title">{tour.name}</h2>
          <p className="music-concert-wall-modal-count">{tour.concertCount} 场</p>
          <p className="music-concert-wall-modal-description">{tour.description?.trim() || '简介暂未整理。'}</p>
          <Link href={archiveHref(tour)} className="music-concert-wall-modal-link" onClick={(event) => event.stopPropagation()}>查看完整巡演详情 <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </div>
  </div>
}

export function MusicConcertTimeline({ tours, compact = false }: Readonly<{ tours: ConcertTimelineTour[]; compact?: boolean }>) {
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

  return <section className={`music-concert-wall-archive${compact ? ' is-compact' : ''}`} aria-label="Eason in Concert 数字档案馆">
    <div className="music-concert-wall-layout">
      <ConcertArchiveWall tours={largeConcerts} side="large" compact={compact} onOpen={setExpandedTour} />
      <MyLivePanel tours={tours} />
      <ConcertArchiveWall tours={smallConcerts} side="small" compact={compact} onOpen={setExpandedTour} />
    </div>
    {expandedTour ? <ExpandedConcert tour={expandedTour} onClose={() => setExpandedTour(null)} /> : null}
  </section>
}
