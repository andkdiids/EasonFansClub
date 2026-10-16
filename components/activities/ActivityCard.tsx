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
  return <span className={`inline-flex shrink-0 items-center rounded-sm border px-2 py-0.5 text-xs font-bold ${statusClasses[activity.displayStatus]}`}>{activityStatusLabel(activity.displayStatus)}</span>
}

export function ActivityCard({ activity, href = `/activities/${activity.id}`, participation }: Readonly<{
  activity: ActivityView
  href?: string
  participation?: Readonly<{ status: string; rewardStatus: string }>
}>) {
  const cover = publicImageVariantUrl(activity.coverUrl || activity.bannerUrl, 'card')
  const isTopicActivity = activity.type === 'TOPIC_ACTIVITY'
  const participationLabel = participation?.status === 'APPROVED' ? '已通过' : participation?.status === 'PENDING' ? '待审核' : participation?.status === 'REJECTED' ? '未通过' : null
  const rewardLabel = participation?.rewardStatus === 'GRANTED' ? '奖励已发放' : participation?.rewardStatus === 'PENDING' ? '奖励待发放' : null
  return (
    <Link href={href} className="group flex min-w-0 overflow-hidden rounded-sm border border-[var(--border)] bg-[var(--surface)] transition hover:border-[var(--primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary)]">
      <div className="relative w-[112px] shrink-0 self-stretch overflow-hidden bg-[var(--surface-subtle)] sm:w-[156px]">
        {cover ? <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={`${activity.title}活动封面`} className="absolute inset-0 h-full w-full object-contain" loading="lazy" />
        </> : <div className="absolute inset-0 flex items-center justify-center text-3xl font-black text-[var(--foreground-muted)]">E</div>}
      </div>
      <div className="min-w-0 flex-1 p-3 sm:p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5"><ActivityStatusBadge activity={activity} /><span className="truncate text-[11px] font-black text-[var(--foreground-muted)]">{activityTypeLabels[activity.type]}</span>{activity.isFeatured ? <span className="text-[11px] font-black text-[var(--warning)]">精选</span> : null}{activity.pinToPlaza && activity.displayStatus !== 'ENDED' && activity.displayStatus !== 'CANCELLED' ? <span className="text-[11px] font-black text-[var(--primary)]">广场置顶</span> : null}</div>
        <h2 className="mt-2 line-clamp-2 break-words text-base font-black text-[var(--foreground)] sm:text-lg">{activity.title}</h2>
        {activity.subtitle ? <p className="mt-1 line-clamp-1 text-xs text-[var(--foreground-muted)]">{activity.subtitle}</p> : null}
        <div className="mt-2 space-y-1 text-[11px] leading-5 text-[var(--foreground-muted)] sm:text-xs">
          {activity.startsAt ? <p className="truncate">时间：{activityDateLabel(activity.startsAt)}{activity.endsAt ? ` — ${activityDateLabel(activity.endsAt)}` : ''}</p> : null}
          {activity.locationName ? <p className="truncate">地点：{activity.locationName}</p> : null}
          {isTopicActivity ? <>
            {participationLabel ? <p>{participationLabel}{rewardLabel ? ` · ${rewardLabel}` : ''}</p> : null}
          </> : <p>{activity.signupLimit !== null && activity.signupLimit > 0 ? `报名：${activity.signupCount}/${activity.signupLimit}` : `报名：${activity.signupCount}人`}</p>}
        </div>
        <span className="mt-2 block text-right text-xs font-bold text-[var(--primary)]">查看 →</span>
      </div>
    </Link>
  )
}
