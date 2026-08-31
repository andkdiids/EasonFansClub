import Link from 'next/link'
import { activityDateLabel, activityStatusLabel, activityTypeLabels, type ActivityView } from '@/lib/activity'
import { publicImageVariantUrl } from '@/lib/image-variants'

const statusClasses = {
  DRAFT: 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground-muted)]',
  UPCOMING: 'border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] bg-[color-mix(in_srgb,var(--primary)_12%,var(--surface))] text-[var(--primary)]',
  ONGOING: 'border-[color-mix(in_srgb,var(--success)_40%,var(--border))] bg-[color-mix(in_srgb,var(--success)_12%,var(--surface))] text-[var(--success)]',
  ENDED: 'border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--foreground-muted)]',
  CANCELLED: 'border-[color-mix(in_srgb,var(--danger)_40%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_12%,var(--surface))] text-[var(--danger)]',
} as const

export function ActivityStatusBadge({ activity }: Readonly<{ activity: Pick<ActivityView, 'displayStatus'> }>) {
  return <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-black ${statusClasses[activity.displayStatus]}`}>{activityStatusLabel(activity.displayStatus)}</span>
}

export function ActivityCard({ activity, href = `/activities/${activity.id}` }: Readonly<{ activity: ActivityView; href?: string }>) {
  const cover = publicImageVariantUrl(activity.coverUrl || activity.bannerUrl, 'card')
  return (
    <Link href={href} className="group block min-w-0 overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/85 dark:hover:border-sky-700">
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-sky-50 dark:bg-slate-950">
        {cover ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={`${activity.title}活动封面`} className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" loading="lazy" />
        </> : <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-sky-100 via-white to-indigo-100 text-4xl font-black text-brand-700/55 dark:from-slate-800 dark:via-slate-900 dark:to-slate-800">E</div>}
      </div>
      <div className="min-w-0 p-3 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5"><ActivityStatusBadge activity={activity} /><span className="truncate text-[11px] font-black text-[var(--foreground-muted)]">{activityTypeLabels[activity.type]}</span>{activity.isFeatured ? <span className="text-[11px] font-black text-[var(--warning)]">精选</span> : null}</div>
        <h2 className="mt-2 line-clamp-2 break-words text-base font-black text-[var(--foreground)] sm:mt-3 sm:text-xl">{activity.title}</h2>
        {activity.subtitle ? <p className="mt-1 line-clamp-1 break-words text-xs font-bold text-[var(--foreground-muted)] sm:line-clamp-2 sm:text-sm">{activity.subtitle}</p> : null}
        <p className="mt-2 hidden line-clamp-3 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--foreground-muted)] sm:mt-3 sm:block">{activity.description}</p>
        <div className="mt-3 space-y-1 text-[11px] font-bold leading-5 text-[var(--foreground-muted)] sm:mt-4 sm:text-xs">
          {activity.startsAt ? <p className="truncate">时间：{activityDateLabel(activity.startsAt)}{activity.endsAt ? ` — ${activityDateLabel(activity.endsAt)}` : ''}</p> : null}
          {activity.locationName ? <p className="truncate">地点：{activity.locationName}</p> : null}
          <p>{activity.signupLimit !== null && activity.signupLimit > 0 ? `报名：${activity.signupCount}/${activity.signupLimit}` : `报名：${activity.signupCount}人`}</p>
        </div>
      </div>
    </Link>
  )
}
