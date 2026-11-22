import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MemoirReader } from '@/app/activities/[activityId]/annual-memoir/MemoirReader'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AnnualMemoirPreview({ params }: { params: Promise<{ activityId: string }> }) {
  const user = await getCurrentUser()
  if (!user || !await hasAdminPermission(user, 'activity_manage')) notFound()
  const { activityId } = await params
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, type: 'TOPIC_ACTIVITY' },
    select: { title: true, description: true, coverUrl: true },
  })
  if (!activity) notFound()
  const cover = publicImageUrl(activity.coverUrl)
  return <main className="mx-auto max-w-xl p-4">
    <Link href="/admin/activities">返回活动管理</Link>
    <h1 className="my-3 text-xl font-bold">年度活动只读预览 · {activity.title}</h1>
    <p>只读预览使用示例数据。昵称、UID、加入日期和活动记录均为示例。</p>
    {cover && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={cover} alt={activity.title} className="my-4 max-h-56 w-full object-contain" />
    )}
    <p className="whitespace-pre-wrap">{activity.description}</p>
    <details className="my-4 border p-3">
      <summary>预览预约确认</summary>
      <p>预约成功后，将获得本次活动的预约奖励。预约不可取消，也不能重复预约。</p>
    </details>
    <MemoirReader activityId={activityId} year={2026} canGenerate={false} preview initialReport={{
      nickname: '葡萄树下的阿晴', uid: 747272, registered: '2026-08-19', longestCheckInRun: 6, featuredBadge: '日子有功', featuredBadgeDate: '2026-09-05',
      communityMemory: { kind: 'POST', excerpt: '散场以后，大家一边哼着歌，一边慢慢走回地铁站。', date: '2026-10-18' },
      bestGame: { score: 128, mode: '粤语残片' }, monthlyFirsts: 1, weeklyFirsts: 3,
      activeDays: 12, checkIns: 8, checkInExperience: 20, posts: 3, replies: 6, likesGiven: 20,
      likesReceived: 9, friends: 2, badges: 1, topics: 2,
      offlineMeetups: 1, title: '故事记录者', message: '等到葡萄成熟时，才发现这一年，原来已经这么甜。',
    }} />
  </main>
}
