import Link from 'next/link'
import { ActivityShareButton } from '@/components/activities/ActivityShareButton'
import { ActivityStatusBadge } from '@/components/activities/ActivityCard'
import { ActivityRegistrationButton } from '@/components/activities/ActivityRegistrationButton'
import { activityDateLabel, activityTypeLabels, type ActivityView } from '@/lib/activity'
import type { ActivityRegistrationQuestionView, ActivityRegistrationState, ActivityRegistrationView } from '@/lib/activity-registration-shared'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { createActivityShareCardDescription, createActivityShareDescription, firstShareCardImageCandidate, shareCardImageCandidates } from '@/lib/share-metadata'
import { canonicalShareUrl, type ShareCardData } from '@/lib/share-card'
import { normalizeActionUrl } from '@/lib/url-safety'
import { ActivityLotteryPanel } from '@/components/activities/ActivityLotteryPanel'
import type { ActivityLotteryPublicView } from '@/lib/activity-lottery'

export function ActivityDetailView({ activity, preview = false, isAuthenticated = false, initialRegistration = null, initialQuestions = [], initialRegistrationState, initialCanRegister, shareAuthor, lotteries = [] }: Readonly<{
  activity: ActivityView
  preview?: boolean
  isAuthenticated?: boolean
  initialRegistration?: ActivityRegistrationView | null
  initialQuestions?: ActivityRegistrationQuestionView[]
  initialRegistrationState?: ActivityRegistrationState
  initialCanRegister?: boolean
  shareAuthor?: Readonly<{ name: string; avatarUrl: string | null }>
  lotteries?: ActivityLotteryPublicView[]
}>) {
  const cover = publicImageVariantUrl(activity.bannerUrl || activity.coverUrl, 'large')
  const onlineUrl = activity.onlineUrl ? normalizeActionUrl(activity.onlineUrl) : null
  const shareTime = activity.startsAt ? `${activityDateLabel(activity.startsAt)}${activity.endsAt ? ` — ${activityDateLabel(activity.endsAt)}` : ''}` : ''
  const shareLocation = [activity.locationName, activity.locationAddress].filter(Boolean).join('，')
  const shareCardImage = firstShareCardImageCandidate([{ url: activity.bannerUrl }, { url: activity.coverUrl }])
  const shareCardImages = shareCardImageCandidates([{ url: activity.bannerUrl }, { url: activity.coverUrl }])
  const shareCardData: ShareCardData = {
    type: 'activity',
    contentId: activity.id,
    title: activity.title,
    description: createActivityShareCardDescription(activity),
    image: shareCardImage?.url || null,
    imageCandidates: shareCardImages,
    url: canonicalShareUrl(`/activities/${activity.id}`),
    author: shareAuthor?.name || activity.organizer || '私家E院',
    authorAvatar: shareAuthor?.avatarUrl || null,
    date: activity.publishedAt ? activityDateLabel(activity.publishedAt) : activityDateLabel(activity.createdAt),
    meta: [
      ...(shareTime ? [{ label: '活动时间', value: shareTime }] : []),
      ...(shareLocation ? [{ label: '活动地点', value: shareLocation }] : []),
    ],
  }
  const layoutClass = preview
    ? 'min-w-0'
    : 'grid min-w-0 items-start lg:grid-cols-[340px_minmax(0,1fr)_320px] xl:grid-cols-[380px_minmax(0,1fr)_340px]'
  const contentClass = preview ? 'p-4 sm:p-7' : 'p-4 sm:p-7 lg:contents'
  const posterClass = preview ? 'min-w-0' : 'min-w-0 self-start h-auto lg:border-r lg:border-[var(--border)] lg:p-4 xl:p-3'
  const detailsClass = preview ? 'min-w-0' : 'min-w-0 self-start h-auto lg:p-7 xl:p-8'
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--foreground)] shadow-sm">
      <div className={layoutClass}>
        <div className={contentClass}>
          <div className={posterClass}>
            {cover ? <div className="mb-6 flex min-h-[15rem] items-center justify-center overflow-hidden rounded-2xl bg-[var(--surface-subtle)] p-3 sm:min-h-[22rem] sm:p-5 lg:mb-0 lg:min-h-0 lg:p-2 xl:p-1"><img src={cover} alt={`${activity.title}活动海报`} className="max-h-[60vh] w-auto max-w-full object-contain sm:max-h-[34rem] lg:h-auto lg:w-full lg:max-w-[360px] lg:max-h-[38rem]" loading={preview ? 'lazy' : 'eager'} /></div> : null}
          </div>
          <div className={detailsClass}>
          <div className="flex flex-wrap items-center gap-2"><ActivityStatusBadge activity={activity} /><span className="text-xs font-black text-[var(--foreground-muted)]">{activityTypeLabels[activity.type]}</span>{activity.isPinned ? <span className="text-xs font-black text-[var(--primary)]">置顶</span> : null}</div>
          <h1 className="mt-3 break-words text-3xl font-black text-[var(--foreground)] sm:text-4xl">{activity.title}</h1>
          {activity.subtitle ? <p className="mt-2 break-words text-base font-bold text-[var(--foreground-muted)]">{activity.subtitle}</p> : null}
          <div className="mt-5 grid min-w-0 gap-2 text-sm font-bold leading-6 text-[var(--foreground-muted)] sm:grid-cols-2">
            {activity.startsAt ? <p>活动时间：{activityDateLabel(activity.startsAt)}{activity.endsAt ? ` — ${activityDateLabel(activity.endsAt)}` : ''}</p> : null}
            {activity.registrationStartAt || activity.registrationEndAt ? <p>报名时间：{activity.registrationStartAt ? activityDateLabel(activity.registrationStartAt) : '不限开始时间'}{activity.registrationEndAt ? ` — ${activityDateLabel(activity.registrationEndAt)}` : ' — 不限截止时间'}</p> : null}
            {activity.locationName ? <p>活动地点：{activity.locationName}</p> : null}
            {activity.locationAddress ? <p>详细地址：{activity.locationAddress}</p> : null}
            {onlineUrl ? <p>线上链接：<a href={onlineUrl} target="_blank" rel="noreferrer" className="text-[var(--primary)] underline decoration-sky-300 underline-offset-4">打开活动链接</a></p> : null}
            {activity.organizer ? <p>主办方：{activity.organizer}</p> : null}
            {activity.contactInfo ? <p>联系方式：{activity.contactInfo}</p> : null}
          </div>
          <section className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-950 dark:border-emerald-900/70 dark:bg-emerald-950/20 dark:text-emerald-100"><p className="font-black">报名费用：{activity.registrationFee > 0 ? `${activity.registrationFee} 挂号费` : '免费'}</p><p className="mt-2 font-bold leading-6">{activity.registrationFee > 0 ? `报名成功后将立即扣除 ${activity.registrationFee} 挂号费。` : '这是一次免费报名。'}</p><p className="mt-2 font-bold leading-6">{activity.registrationFee > 0 ? '在报名结束前取消报名可退回本次实际支付费用。' : '免费报名也会保留报名记录。'}取消报名后不可再次报名本活动。</p>{activity.feeDescription ? <p className="mt-2 whitespace-pre-wrap break-words font-bold leading-6">{activity.feeDescription}</p> : null}{activity.linkedMaterial ? <div className="mt-3 border-t border-emerald-200 pt-3 dark:border-emerald-900/70"><p className="font-black">报名福利</p><div className="mt-2 flex items-center gap-3"><div className="size-14 shrink-0 overflow-hidden rounded-lg bg-white/70 dark:bg-slate-900/60">{activity.linkedMaterial.coverImageUrl ? <img src={activity.linkedMaterial.coverImageUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-2xl">🎁</div>}</div><p className="min-w-0 break-words font-black">{activity.linkedMaterial.title} ×1</p></div><p className="mt-2 font-bold leading-6">报名成功后自动兑换；现场活动签到时将同步完成物料核销，无需重复扫码。</p>{activity.linkedMaterial.stockRemaining < 1 || activity.linkedMaterial.status !== 'PUBLISHED' ? <p className="mt-2 font-black text-rose-700">{activity.linkedMaterial.stockRemaining < 1 ? '活动物料已兑换完' : '活动物料暂不可用'}，暂时无法报名。</p> : null}</div> : null}</section>
          <div className="mt-7 whitespace-pre-wrap break-words text-[15px] leading-8 text-[var(--foreground)]">{activity.description || '暂无活动说明。'}</div>
          {!preview && lotteries?.length ? <ActivityLotteryPanel lotteries={lotteries} isRegistered={initialRegistration?.status === 'ACTIVE'} /> : null}
          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-5">{!preview ? <Link href="/activities" className="min-h-10 rounded-full bg-[var(--navigation-active)] px-4 py-2 text-sm font-black text-[var(--primary)] hover:opacity-80">← 返回活动中心</Link> : null}{!preview ? <ActivityShareButton data={shareCardData} title={activity.title} text={createActivityShareDescription(activity)} /> : null}</div>
          </div>
        </div>
        {!preview ? <aside className="min-w-0 self-start h-auto border-t border-[var(--border)] bg-[var(--surface-subtle)] p-4 sm:p-7 lg:border-l lg:border-t-0 lg:p-6 lg:[&>section]:mt-0"><ActivityRegistrationButton activity={activity} isAuthenticated={isAuthenticated} initialRegistration={initialRegistration} questions={initialQuestions} initialRegistrationCount={activity.signupCount} initialRegistrationState={initialRegistrationState} initialCanRegister={initialCanRegister} /></aside> : null}
      </div>
    </article>
  )
}
