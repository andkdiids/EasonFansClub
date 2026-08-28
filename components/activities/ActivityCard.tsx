import Link from 'next/link'
import { activityDateLabel, activityStatusLabel, activityTypeLabels, type ActivityView } from '@/lib/activity'
import { publicImageVariantUrl } from '@/lib/image-variants'

const statusClasses = {
  DRAFT: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  UPCOMING: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  ONGOING: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  ENDED: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  CANCELLED: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200',
} as const

export function ActivityStatusBadge({ activity }: Readonly<{ activity: Pick<ActivityView, 'displayStatus'> }>) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-black ${statusClasses[activity.displayStatus]}`}>{activityStatusLabel(activity.displayStatus)}</span>
}

export function ActivityCard({ activity, href = `/activities/${activity.id}` }: Readonly<{ activity: ActivityView; href?: string }>) {
  const cover = publicImageVariantUrl(activity.coverUrl || activity.bannerUrl, 'card')
  return (
    <Link href={href} className="group block overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/85 dark:hover:border-sky-700">
      <div className="grid min-w-0 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
        <div className="relative w-full self-start aspect-[3/4] overflow-hidden bg-sky-50 dark:bg-slate-950">
          {cover ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={cover} alt={`${activity.title}活动封面`} className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" loading="lazy" />
          ) : <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-sky-100 via-white to-indigo-100 text-4xl font-black text-brand-700/55 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800">E</div>}
        </div>
        <div className="min-w-0 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <ActivityStatusBadge activity={activity} />
            <span className="text-xs font-black text-slate-400 dark:text-slate-500">{activityTypeLabels[activity.type]}</span>
            {activity.isFeatured ? <span className="text-xs font-black text-amber-600 dark:text-amber-300">精选</span> : null}
          </div>
          <h2 className="mt-3 line-clamp-2 break-words text-xl font-black text-brand-950 dark:text-slate-100">{activity.title}</h2>
          {activity.subtitle ? <p className="mt-1 line-clamp-2 break-words text-sm font-bold text-slate-500 dark:text-slate-400">{activity.subtitle}</p> : null}
          {activity.description ? <p className="mt-3 line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600 dark:text-slate-300">{activity.description}</p> : null}
          <div className="mt-4 space-y-1 text-xs font-bold leading-5 text-slate-500 dark:text-slate-400">
            {activity.startsAt ? <p>时间：{activityDateLabel(activity.startsAt)}{activity.endsAt ? ` — ${activityDateLabel(activity.endsAt)}` : ''}</p> : null}
            {activity.locationName ? <p className="truncate">地点：{activity.locationName}</p> : null}
            <p>{activity.signupLimit !== null && activity.signupLimit > 0 ? `报名：${activity.signupCount}/${activity.signupLimit}` : `报名：${activity.signupCount}人`}</p>
          </div>
        </div>
      </div>
    </Link>
  )
}
