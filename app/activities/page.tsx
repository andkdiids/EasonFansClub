import { prisma } from '@/lib/prisma'
import { HeroBackground } from '@/components/HeroBackground'
import { getSiteAppearance } from '@/lib/site-config'
import { ActivitiesListClient } from '@/components/activities/ActivitiesListClient'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { sortActivities } from '@/lib/activity'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'
import { getPublicConcertEvent } from '@/lib/concert-events'
import { getConcertTimelineState } from '@/lib/concert-timeline'
import { ConcertCountdown } from '@/components/concerts/ConcertCountdown'
import Link from 'next/link'
import Image from 'next/image'
import { publicImageUrl } from '@/lib/images'

export const dynamic = 'force-dynamic'

function dateLabel(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat('zh-HK', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Hong_Kong' }).format(date)
}

function concertBackgroundImage(value: unknown) {
  if (!value || typeof value !== 'object' || !('backgroundImageUrl' in value)) return null
  const imageUrl = (value as { backgroundImageUrl?: unknown }).backgroundImageUrl
  return publicImageUrl(typeof imageUrl === 'string' ? imageUrl : null)
}

export default async function ActivitiesPage() {
  const [publishedActivities, config, user] = await Promise.all([
    prisma.activity.findMany({ where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, take: 100, select: activitySelect }),
    getSiteAppearance(),
    getCurrentUser(),
  ])
  const activities = sortActivities(publishedActivities.map((activity) => serializeActivityRow(activity))).slice(0, 100)
  const canCheckIn = user ? await hasAdminPermission(user, 'activity_manage').catch(() => false) : false
  const featuredConcert = await prisma.concertEvent.findFirst({ where: { activityCenterVisible: true, status: { in: ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING'] } }, orderBy: { updatedAt: 'desc' }, select: { slug: true } }).catch(() => null)
  const concert = featuredConcert ? await getPublicConcertEvent(featuredConcert.slug, user?.id).catch(() => null) : null
  const concertBackgroundUrl = concertBackgroundImage(concert)
  const firstConcertShow = concert?.shows[0]
  const lastConcertShow = concert?.shows[concert.shows.length - 1]
  const concertTimelineState = concert ? getConcertTimelineState(concert.timeline, new Date(concert.serverNow), concert.timezone, concert.status) : null
  // ActivityCard renders each detail link as href={`/activities/${item.id}`}.
  const banner = config.heroVisuals.activities
  const hasBanner = banner.enabled && Boolean(banner.mediaUrl || banner.imageUrl || banner.posterUrl || config.images.activityCoverUrl)

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-5">
        <section className={`relative isolate overflow-hidden border ${hasBanner ? 'border-slate-800 bg-[#071523] text-white' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]'}`}>
          <HeroBackground visual={banner} fallbackImageUrl={config.images.activityCoverUrl} priority />
          {hasBanner ? <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/35 to-black/10" /> : null}
          <div className="relative z-10 p-4 sm:px-6 sm:py-5"><h1 className="text-2xl font-black">活动中心</h1><p className={`mt-2 max-w-2xl text-sm leading-6 ${hasBanner ? 'text-white/80' : 'text-[var(--foreground-muted)]'}`}>演唱会、线下聚会、线上活动和粉丝福利。</p></div>
        </section>
        {concert ? <section className="relative isolate overflow-hidden border border-slate-800 bg-slate-950 text-white shadow-lg">
          {concertBackgroundUrl ? <Image src={concertBackgroundUrl} alt="" fill sizes="(max-width: 640px) 100vw, 1280px" className="object-cover" unoptimized /> : null}
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/75 to-slate-950/55" />
          <div className="relative z-10 flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:p-6">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[.22em] text-white/70">限时演唱会专题</p>
              <h2 className="mt-1 text-xl font-black sm:text-2xl">{concert.title}</h2>
              {concert.subtitle ? <p className="mt-1 text-sm text-white/85">{concert.subtitle}</p> : null}
              <p className="mt-2 text-sm text-white/85">{firstConcertShow ? dateLabel(firstConcertShow.date) : '日期待定'}{lastConcertShow ? ` — ${dateLabel(lastConcertShow.date)}` : ''} · {concert.shows.length} 场</p>
              {concertTimelineState ? <div className="mt-2"><ConcertCountdown target={concertTimelineState.target} label={concertTimelineState.countdownLabel || '最近活动节点'} serverNow={concert.serverNow} /></div> : null}
              <p className="mt-1 text-xs text-white/75">{concert.totalWantToGo} 人想看 · {concert.totalHasTicket} 人有票</p>
            </div>
            <Link href={`/concerts/${concert.slug}`} className="inline-flex min-h-11 shrink-0 items-center justify-center border border-white/50 px-4 text-sm font-black text-white hover:bg-white/10">进入专题 →</Link>
          </div>
        </section> : null}
        <ActivitiesListClient initialActivities={activities} canCheckIn={canCheckIn} isAuthenticated={Boolean(user)} />
      </main>
    </>
  )
}
