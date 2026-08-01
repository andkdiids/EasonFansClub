import Image from 'next/image'
import Link from 'next/link'
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

type ConcertTrackSide = 'large' | 'small'

const SMALL_CONCERT_NAMES = [
  'Eason Says C’mon in Tour',
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

function ConcertTrack({ tours, side, compact }: Readonly<{ tours: ConcertTimelineTour[]; side: ConcertTrackSide; compact: boolean }>) {
  const isLarge = side === 'large'
  const title = isLarge ? '大型演唱会' : '小型企划'
  const eyebrow = isLarge ? 'MAIN STAGES' : 'SPECIAL STAGES'

  return (
    <section className={`music-concert-archive-track music-concert-archive-track--${side}`} aria-labelledby={`music-concert-${side}-title`}>
      <header className="music-concert-archive-track-heading">
        <p>{eyebrow}</p>
        <h2 id={`music-concert-${side}-title`}>{title}</h2>
      </header>
      <div className="music-concert-archive-rail">
        <span className="music-concert-archive-rail-line" aria-hidden="true" />
        {tours.length ? (
          <div className="music-concert-archive-track-list">
            {tours.map((tour) => (
              <article key={tour.id} className="music-concert-archive-node">
                <span className="music-concert-archive-node-dot" aria-hidden="true" />
                <div className="music-concert-archive-node-content">
                  <time dateTime={tour.startDate ? new Date(tour.startDate).toISOString() : undefined}>{formatYear(tour.startDate)}</time>
                  <Link href={archiveHref(tour)} className="music-concert-archive-card group">
                    <div className="music-concert-archive-poster">
                      {tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill sizes={compact ? '(max-width: 767px) 84px, 72px' : '(max-width: 767px) 92px, 88px'} className="object-contain transition duration-500 group-hover:scale-[1.03]" /> : <span>LIVE</span>}
                    </div>
                    <div className="music-concert-archive-card-body">
                      <h3>{tour.name}</h3>
                      <p>{tour.concertCount} 场</p>
                    </div>
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : <p className="music-concert-archive-empty">暂无收录</p>}
      </div>
    </section>
  )
}

function ConcertArchiveCenter({ tours }: Readonly<{ tours: ConcertTimelineTour[] }>) {
  return (
    <section className="music-concert-archive-center" aria-labelledby="music-concert-my-live-title">
      <div className="music-concert-archive-center-orbit" aria-hidden="true" />
      <div className="music-concert-archive-center-panel">
        <p className="music-concert-archive-center-eyebrow">PERSONAL ARCHIVE</p>
        <h2 id="music-concert-my-live-title">MY LIVE</h2>
        <p className="music-concert-archive-center-title">我的现场</p>
        <dl className="music-concert-archive-stats">
          <div><dd>--</dd><dt>场现场</dt></div>
          <div><dd>--</dd><dt>个巡演</dt></div>
        </dl>
        <div className="music-concert-archive-recent">
          <span>最近现场</span>
          <strong>--</strong>
        </div>
        <div className="music-concert-archive-register">
          <p>TOUR REGISTER</p>
          <ul>
            {tours.slice(0, 4).map((tour) => <li key={tour.id}>{tour.name}</li>)}
            {!tours.length ? <li>--</li> : null}
          </ul>
        </div>
        <Link href="/music/live/me" className="music-concert-archive-center-link">进入我的现场 <span aria-hidden="true">→</span></Link>
      </div>
    </section>
  )
}

export function MusicConcertTimeline({ tours, compact = false }: Readonly<{ tours: ConcertTimelineTour[]; compact?: boolean }>) {
  const largeConcerts = tours.filter((tour) => !isSmallConcert(tour))
  const smallConcerts = tours.filter(isSmallConcert)

  return (
    <section className={`music-concert-timeline music-concert-archive${compact ? ' is-compact' : ''}`} aria-label="Eason in Concert 数字档案馆">
      <div className="music-concert-archive-grid">
        <ConcertTrack tours={largeConcerts} side="large" compact={compact} />
        <ConcertArchiveCenter tours={tours} />
        <ConcertTrack tours={smallConcerts} side="small" compact={compact} />
      </div>
    </section>
  )
}
