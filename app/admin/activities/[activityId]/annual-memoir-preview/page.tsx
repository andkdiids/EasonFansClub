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
    <p>报告使用合成数据。预约、截图审核及奖励写入请在隔离测试环境验证。</p>
    {cover && (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={cover} alt={activity.title} className="my-4 max-h-56 w-full object-contain" />
    )}
    <p className="whitespace-pre-wrap">{activity.description}</p>
    <details className="my-4 border p-3">
      <summary>预览预约确认</summary>
      <p>预约成功后，将获得本次活动的预约奖励。预约不可取消，也不能重复预约。</p>
    </details>
    <MemoirReader activityId={activityId} year={2026} canGenerate={false} initialReport={{
      nickname: '年度回忆录预览用户', uid: 42, registered: '2026-01-01', firstRecordedDay: '',
      activeDays: 12, checkIns: 8, checkInExperience: 20, posts: 3, replies: 6, likesGiven: 20,
      likesReceived: 9, friends: 2, followers: 3, games: 2, bestScore: 8, badges: 1, topics: 2,
      verified: 1, title: '故事记录者', message: '等到葡萄成熟时，才发现这一年，原来已经这么甜。',
    }} />
  </main>
}
