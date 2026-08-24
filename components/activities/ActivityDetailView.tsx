import Link from 'next/link'
import { ActivityShareButton } from '@/components/activities/ActivityShareButton'
import { ActivityStatusBadge } from '@/components/activities/ActivityCard'
import { activityDateLabel, activityTypeLabels, type ActivityView } from '@/lib/activity'
import { publicImageVariantUrl } from '@/lib/image-variants'

export function ActivityDetailView({ activity, preview = false }: Readonly<{ activity: ActivityView; preview?: boolean }>) {
  const cover = publicImageVariantUrl(activity.bannerUrl || activity.coverUrl, 'large')
  return (
    <article className="overflow-hidden rounded-2xl border border-sky-100 bg-white/90 shadow-sm dark:border-slate-700 dark:bg-slate-900/90">
      {cover ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={cover} alt={`${activity.title}活动横幅`} className="max-h-[32rem] w-full object-cover" loading={preview ? 'lazy' : 'eager'} />
      ) : null}
      <div className="p-6 sm:p-9">
        <div className="flex flex-wrap items-center gap-2">
          <ActivityStatusBadge activity={activity} />
          <span className="text-xs font-black text-slate-400 dark:text-slate-500">{activityTypeLabels[activity.type]}</span>
          {activity.isPinned ? <span className="text-xs font-black text-brand-700 dark:text-sky-300">置顶</span> : null}
        </div>
        <h1 className="mt-3 break-words text-3xl font-black text-brand-950 sm:text-4xl dark:text-slate-100">{activity.title}</h1>
        {activity.subtitle ? <p className="mt-2 break-words text-base font-bold text-slate-500 dark:text-slate-400">{activity.subtitle}</p> : null}
        <div className="mt-5 grid gap-2 text-sm font-bold leading-6 text-slate-600 sm:grid-cols-2 dark:text-slate-300">
          {activity.startsAt ? <p>活动时间：{activityDateLabel(activity.startsAt)}{activity.endsAt ? ` — ${activityDateLabel(activity.endsAt)}` : ''}</p> : null}
          {activity.registrationStartAt ? <p>报名时间：{activityDateLabel(activity.registrationStartAt)}{activity.registrationEndAt ? ` — ${activityDateLabel(activity.registrationEndAt)}` : ''}</p> : null}
          {activity.locationName ? <p>活动地点：{activity.locationName}</p> : null}
          {activity.locationAddress ? <p>详细地址：{activity.locationAddress}</p> : null}
          {activity.onlineUrl ? <p>线上链接：<a href={activity.onlineUrl} target="_blank" rel="noreferrer" className="text-brand-700 underline decoration-sky-300 underline-offset-4 dark:text-sky-300">打开活动链接</a></p> : null}
          {activity.signupLimit !== null ? <p>报名名额：{activity.signupCount}/{activity.signupLimit}</p> : null}
          {activity.organizer ? <p>主办方：{activity.organizer}</p> : null}
          {activity.contactInfo ? <p>联系方式：{activity.contactInfo}</p> : null}
        </div>
        <div className="mt-7 whitespace-pre-wrap break-words text-[15px] leading-8 text-slate-700 dark:text-slate-200">{activity.description || '暂无活动说明。'}</div>
        <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-sky-100 pt-5 dark:border-slate-700">
          {!preview ? <Link href="/activities" className="min-h-10 rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700 hover:bg-sky-100 dark:bg-slate-800 dark:text-sky-200 dark:hover:bg-slate-700">← 返回活动中心</Link> : null}
          {!preview ? <ActivityShareButton title={activity.title} /> : null}
        </div>
      </div>
    </article>
  )
}
