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

function year(value: Date | string | null | undefined) {
  if (!value) return 'ARCHIVE'
  return String(new Date(value).getUTCFullYear())
}

export function MusicConcertTimeline({ tours, compact = false }: Readonly<{ tours: ConcertTimelineTour[]; compact?: boolean }>) {
  return (
    <div className={`music-concert-timeline${compact ? ' is-compact' : ''}`}>
      <div className="music-concert-timeline-track" aria-hidden="true" />
      <div className="music-concert-timeline-list">
        {tours.map((tour, index) => {
          const side = index % 2 === 0 ? 'left' : 'right'

          return (
            <article key={tour.id} className="music-concert-timeline-node" data-side={side}>
              <div className="music-concert-timeline-content">
                <Link href={`/music/live/tours/${generateArchiveSlug(tour.name)}`} className="music-concert-timeline-card group">
                  <div className="music-concert-timeline-poster">
                    {tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill sizes="(max-width: 767px) 132px, 108px" className="object-cover transition duration-500 group-hover:scale-105" /> : <div className="grid h-full place-items-center text-3xl font-black text-sky-200/20">LIVE</div>}
                  </div>
                  <div className="music-concert-timeline-body">
                    <time dateTime={tour.startDate ? new Date(tour.startDate).toISOString() : undefined}>{year(tour.startDate)}</time>
                    <h3>{tour.name}</h3>
                    <p>{tour.concertCount} 场</p>
                  </div>
                </Link>
              </div>
              <span className="music-concert-timeline-dot" aria-hidden="true" />
            </article>
          )
        })}
      </div>
    </div>
  )
}
