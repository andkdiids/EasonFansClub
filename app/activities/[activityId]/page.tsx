import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatDate } from '@/lib/format'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function ActivityDetailPage({ params }: Readonly<{ params: Promise<{ activityId: string }> }>) {
  const { activityId } = await params
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, status: 'PUBLISHED' },
  })
  if (!activity) notFound()
  const cover = publicImageVariantUrl(activity.coverUrl, 'large')

  return (
    <main className="site-page-main flat-page mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <Link href="/activities" className="inline-flex text-sm font-black text-brand-700">← 返回活动中心</Link>
      <article className="overflow-hidden border border-sky-100 bg-white/85 shadow-sm">
        {cover ? <img src={cover} alt={`${activity.title}活动封面`} className="max-h-[420px] w-full object-cover" loading="eager" /> : null}
        <div className="p-6 sm:p-8">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">Activity</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">{activity.title}</h1>
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold text-slate-500">
            {activity.startsAt ? <span>开始：{formatDate(activity.startsAt)}</span> : null}
            {activity.endsAt ? <span>结束：{formatDate(activity.endsAt)}</span> : null}
            {activity.signupLimit ? <span>名额：{activity.signupCount}/{activity.signupLimit}</span> : null}
          </div>
          <p className="mt-7 whitespace-pre-wrap break-words leading-8 text-slate-700">{activity.description}</p>
        </div>
      </article>
    </main>
  )
}
