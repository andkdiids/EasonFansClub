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
  return <div className="relative">
    <div className="absolute bottom-0 left-[27px] top-0 w-px bg-gradient-to-b from-sky-300/50 via-sky-300/20 to-transparent sm:left-[78px]" />
    <div className={compact ? 'space-y-8' : 'space-y-12'}>
      {tours.map((tour) => <article key={tour.id} className="relative grid grid-cols-[56px_minmax(0,1fr)] gap-4 sm:grid-cols-[156px_minmax(0,1fr)] sm:gap-7">
        <div className="relative z-10 pt-1 text-right">
          <time className="hidden text-3xl font-black tracking-tight text-sky-200 sm:block">{year(tour.startDate)}</time>
          <span className="mx-auto mt-2 block size-3 rounded-full border-2 border-sky-200 bg-[#07182d] shadow-[0_0_24px_rgba(125,211,252,.55)] sm:ml-auto sm:mr-[-6px]" />
        </div>
        <Link href={`/music/live/tours/${generateArchiveSlug(tour.name)}`} className={`group overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.055] transition hover:-translate-y-1 hover:border-sky-300/30 hover:bg-white/[0.09] ${compact ? 'grid sm:grid-cols-[150px_1fr]' : 'grid md:grid-cols-[230px_1fr]'}`}>
          <div className={`relative bg-[#0b2038] ${compact ? 'aspect-[16/9] sm:aspect-[3/4]' : 'aspect-[16/10] md:aspect-[3/4]'}`}>
            {tour.posterUrl ? <Image src={tour.posterUrl} alt={`${tour.name}演唱会海报`} fill sizes={compact ? '150px' : '(max-width: 768px) 100vw, 230px'} className="object-cover transition duration-500 group-hover:scale-105" /> : <div className="grid h-full place-items-center text-3xl font-black text-sky-200/20">LIVE</div>}
          </div>
          <div className={compact ? 'p-5' : 'p-6 sm:p-8'}>
            <p className="text-xs font-black tracking-[0.2em] text-sky-300/60 sm:hidden">{year(tour.startDate)}</p>
            <h3 className={`${compact ? 'text-xl' : 'text-2xl sm:text-3xl'} mt-2 break-words font-black text-white`}>{tour.name}</h3>
            {tour.subtitle ? <p className="mt-2 text-sm font-bold text-sky-100/65">{tour.subtitle}</p> : null}
            {!compact && tour.description ? <p className="mt-4 line-clamp-3 text-sm font-medium leading-7 text-slate-300/65">{tour.description}</p> : null}
            <p className="mt-5 text-xs font-black text-slate-300/50">{tour.concertCount} 场{tour.cities?.length ? ` · ${tour.cities.slice(0, 4).join(' / ')}` : ''}</p>
            <span className="mt-4 inline-flex text-sm font-black text-sky-200">打开档案 →</span>
          </div>
        </Link>
      </article>)}
    </div>
  </div>
}
