import { prisma } from '@/lib/prisma'
import { HeroBackground } from '@/components/HeroBackground'
import { getSiteAppearance } from '@/lib/site-config'
import { ActivitiesListClient } from '@/components/activities/ActivitiesListClient'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { sortActivities } from '@/lib/activity'

export const dynamic = 'force-dynamic'

export default async function ActivitiesPage() {
  const [publishedActivities, config] = await Promise.all([
    prisma.activity.findMany({ where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, take: 100, select: activitySelect }),
    getSiteAppearance(),
  ])
  const activities = sortActivities(publishedActivities.map((activity) => serializeActivityRow(activity))).slice(0, 100)
  // ActivityCard renders each detail link as href={`/activities/${item.id}`}.
  const banner = config.heroVisuals.activities
  const hasBanner = banner.enabled && Boolean(banner.mediaUrl || banner.imageUrl || banner.posterUrl || config.images.activityCoverUrl)

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-6 px-5 py-8">
        <section className={`relative isolate min-h-64 overflow-hidden border shadow-sm ${hasBanner ? 'border-slate-800 bg-[#071523] text-white' : 'border-sky-100 bg-white/85 text-brand-950'}`}>
          <HeroBackground visual={banner} fallbackImageUrl={config.images.activityCoverUrl} priority />
          {hasBanner ? <div className="absolute inset-0 bg-gradient-to-r from-black/75 via-black/35 to-black/10" /> : null}
          <div className="relative z-10 p-7 sm:p-10"><h1 className="text-4xl font-black">活动中心</h1><p className={`mt-4 max-w-2xl leading-8 ${hasBanner ? 'text-white/80' : 'text-slate-600'}`}>演唱会、线下聚会、线上活动和粉丝福利都会在这里发布。</p></div>
        </section>
        <ActivitiesListClient initialActivities={activities} />
      </main>
    </>
  )
}
