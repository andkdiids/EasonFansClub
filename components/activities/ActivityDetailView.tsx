import Link from 'next/link'
import { ActivityShareButton } from '@/components/activities/ActivityShareButton'
import { ActivityStatusBadge } from '@/components/activities/ActivityCard'
import { ActivityRegistrationButton } from '@/components/activities/ActivityRegistrationButton'
import { activityDateLabel, activityTypeLabels, type ActivityView } from '@/lib/activity'
import type { ActivityRegistrationState } from '@/lib/activity-registration'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { normalizeActionUrl } from '@/lib/url-safety'

export function ActivityDetailView({ activity, preview = false, isAuthenticated = false, initialIsRegistered = false, initialRegistrationState, initialCanRegister }: Readonly<{
  activity: ActivityView
  preview?: boolean
  isAuthenticated?: boolean
  initialIsRegistered?: boolean
  initialRegistrationState?: ActivityRegistrationState
  initialCanRegister?: boolean
}>) {
  const cover = publicImageVariantUrl(activity.bannerUrl || activity.coverUrl, 'large')
  const onlineUrl = activity.onlineUrl ? normalizeActionUrl(activity.onlineUrl) : null
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm">
      {cover ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={cover} alt={`${activity.title}活动横幅`} className="max-h-[32rem] w-full object-cover" loading={preview ? 'lazy' : 'eager'} />
      ) : null}
      <div className="p-6 sm:p-9">
        <div className="flex flex-wrap items-center gap-2">
          <ActivityStatusBadge activity={activity} />
          <span className="text-xs font-black text-[var(--foreground-muted)]">{activityTypeLabels[activity.type]}</span>
          {activity.isPinned ? <span className="text-xs font-black text-[var(--primary)]">置顶</span> : null}
        </div>
        <h1 className="mt-3 break-words text-3xl font-black text-[var(--foreground)] sm:text-4xl">{activity.title}</h1>
        {activity.subtitle ? <p className="mt-2 break-words text-base font-bold text-[var(--foreground-muted)]">{activity.subtitle}</p> : null}
        <div className="mt-5 grid gap-2 text-sm font-bold leading-6 text-[var(--foreground-muted)] sm:grid-cols-2">
          {activity.startsAt ? <p>活动时间：{activityDateLabel(activity.startsAt)}{activity.endsAt ? ` — ${activityDateLabel(activity.endsAt)}` : ''}</p> : null}
          {activity.registrationStartAt ? <p>报名时间：{activityDateLabel(activity.registrationStartAt)}{activity.registrationEndAt ? ` — ${activityDateLabel(activity.registrationEndAt)}` : ''}</p> : null}
          {activity.locationName ? <p>活动地点：{activity.locationName}</p> : null}
          {activity.locationAddress ? <p>详细地址：{activity.locationAddress}</p> : null}
          {onlineUrl ? <p>线上链接：<a href={onlineUrl} target="_blank" rel="noreferrer" className="text-[var(--primary)] underline decoration-sky-300 underline-offset-4">打开活动链接</a></p> : null}
          {activity.organizer ? <p>主办方：{activity.organizer}</p> : null}
          {activity.contactInfo ? <p>联系方式：{activity.contactInfo}</p> : null}
        </div>
        <div className="mt-7 whitespace-pre-wrap break-words text-[15px] leading-8 text-[var(--foreground)]">{activity.description || '暂无活动说明。'}</div>
        {!preview ? <ActivityRegistrationButton activity={activity} isAuthenticated={isAuthenticated} initialIsRegistered={initialIsRegistered} initialRegistrationCount={activity.signupCount} initialRegistrationState={initialRegistrationState} initialCanRegister={initialCanRegister} /> : null}
        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5">
          {!preview ? <Link href="/activities" className="min-h-10 rounded-full bg-[var(--navigation-active)] px-4 py-2 text-sm font-black text-[var(--primary)] hover:opacity-80">← 返回活动中心</Link> : null}
          {!preview ? <ActivityShareButton title={activity.title} /> : null}
        </div>
      </div>
    </article>
  )
}
