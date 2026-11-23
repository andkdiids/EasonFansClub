import Link from 'next/link'
import { notFound } from 'next/navigation'
import { MemoirReader } from '@/app/activities/[activityId]/annual-memoir/MemoirReader'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { previewMemoirBadges } from '@/lib/annual-memoir-badge-data'
import { memoirIdentity } from '@/lib/annual-memoir-identity'

export const dynamic = 'force-dynamic'

const cases = {
  posts: { posts: 6 }, games: { games: 8 }, badges: { badges: 6 },
  social: { friends: 4, interactions: 7 }, activities: { activities: 5 }, quiet: { activeDays: 1 },
} satisfies Record<string, Partial<Parameters<typeof memoirIdentity>[0]>>

export default async function AnnualMemoirPreview({ params, searchParams }: {
  params: Promise<{ activityId: string }>; searchParams: Promise<{ sample?: string }>
}) {
  const user = await getCurrentUser()
  if (!user || !await hasAdminPermission(user, 'activity_manage')) notFound()
  const { activityId } = await params
  const config = await prisma.annualMemoirConfig.findUnique({
    where: { activityId },
    select: { year: true, activity: { select: { type: true, title: true, description: true, coverUrl: true } } },
  })
  if (!config || config.activity.type !== 'TOPIC_ACTIVITY') notFound()
  const { activity, year } = config
  const { sample } = await searchParams
  const previewCase = sample && Object.hasOwn(cases, sample) ? sample as keyof typeof cases : 'posts'
  const stats = { posts: 0, replies: 2, friends: 0, interactions: 2, games: 1, badges: 1, activities: 2, activeDays: 4, ...cases[previewCase] }
  const badgeCollage = await previewMemoirBadges(prisma)
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
    <MemoirReader activityId={activityId} year={year} preview previewCase={previewCase} initialReport={{
      nickname: '葡萄树下的阿晴', uid: 747272, registered: `${year}-08-19`, longestCheckInRun: 6, badgeCollage,
      firstPost: { excerpt: '散场以后，大家一边哼着歌，一边慢慢走回地铁站。', date: `${year}-10-18` },
      topPeer: { nickname: '街灯下的阿禾', wall: Math.floor(stats.interactions / 2), comments: Math.ceil(stats.interactions / 2) },
      bestGame: { score: 128, mode: '粤语残片' }, monthlyFirsts: 1, weeklyFirsts: 3,
      activeDays: stats.activeDays, checkIns: 1, checkInExperience: 3, posts: stats.posts, replies: stats.replies, likesGiven: 3,
      likesReceived: 2, friends: stats.friends, badges: stats.badges, topics: stats.activities - 1,
      offlineMeetups: 1, title: memoirIdentity(stats), message: '等到葡萄成熟时，才发现这一年，原来已经这么甜。',
    }} />
  </main>
}
