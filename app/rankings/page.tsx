import { calculateCheckinStreaks } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'
import { calculateGrowthSummary, listGrowthLevels } from '@/lib/growth'
import { getCurrentUser } from '@/lib/auth'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicPostWhere } from '@/lib/post-moderation'
import { isAdminRole } from '@/lib/security'
import { redirect } from 'next/navigation'
import { publicModerationText } from '@/lib/content-moderation'

export const dynamic = 'force-dynamic'

export default async function RankingsPage() {
  const user = await getCurrentUser()
  if (!user || !isAdminRole(user.role)) redirect('/community')

  // 签到榜:一次性取出未删除用户的全部签到日期键(仅两个小字段),内存分组重算,避免 N+1,不读用户表上的连续天数快照
  const [points, checkInKeys, posts, growthLevels] = await Promise.all([
    prisma.user.findMany({ where: { isDeleted: false }, orderBy: { points: 'desc' }, take: 10, select: { id: true, nickname: true, points: true, experience: true, Profile: { select: { displayName: true } } } }),
    prisma.checkIn.findMany({ where: { User: { isDeleted: false } }, select: { userId: true, checkinDateKey: true } }),
    prisma.post.findMany({ where: publicPostWhere, orderBy: [{ replyCount: 'desc' }, { likeCount: 'desc' }], take: 10, select: { id: true, title: true, moderationStatus: true, replyCount: true, likeCount: true } }),
    listGrowthLevels(),
  ])

  const keysByUser = new Map<string, string[]>()
  for (const row of checkInKeys) {
    const keys = keysByUser.get(row.userId)
    if (keys) keys.push(row.checkinDateKey)
    else keysByUser.set(row.userId, [row.checkinDateKey])
  }
  const streakTop = [...keysByUser.entries()]
    .map(([userId, keys]) => ({ userId, currentStreak: calculateCheckinStreaks(keys).currentStreak }))
    .filter((item) => item.currentStreak > 0)
    .sort((a, b) => b.currentStreak - a.currentStreak)
    .slice(0, 10)
  const streakUsers = await prisma.user.findMany({
    where: { id: { in: streakTop.map((item) => item.userId) } },
    select: { id: true, nickname: true, level: true, Profile: { select: { displayName: true } } },
  })
  const userById = new Map(streakUsers.map((item) => [item.id, item]))
  const remarkMap = await loadFriendRemarkMap(user.id, [
    ...points.map((item) => item.id),
    ...streakTop.map((item) => item.userId),
  ])
  const displayName = (item: { id: string; nickname: string; Profile?: { displayName: string | null } | null }) => resolveFriendDisplayName({
    viewerId: user.id,
    targetUserId: item.id,
    fallbackName: getPublicUserDisplayName(item),
    remarkMap,
  })

  return (
    <>
      <main className="site-page-main flat-page mx-auto max-w-7xl space-y-6 px-5 py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-7 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-brand-700">Rankings</p>
          <h1 className="mt-3 text-4xl font-black text-brand-950">排行榜（管理员调试）</h1>
        </section>
        <section className="grid gap-6 md:grid-cols-3">
          {[
            ['挂号费榜', points.map((u) => { const growth = calculateGrowthSummary(u.experience, growthLevels); return `${displayName(u)} · ${growth.levelName} · Lv.${growth.level} · ${u.points}挂号费` })],
            ['签到榜', streakTop.map((item) => { const u = userById.get(item.userId); return u ? `${displayName(u)} · 连续${item.currentStreak}天` : null }).filter((row): row is string => Boolean(row))],
            ['热帖榜', posts.map((p) => `${publicModerationText(p.title, p.moderationStatus)} · ${p.replyCount}回复 · ${p.likeCount}赞`)],
          ].map(([title, rows]) => (
            <div key={title as string} className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm">
              <h2 className="text-2xl font-black text-brand-950">{title}</h2>
              <div className="mt-4 space-y-3">
                {(rows as string[]).map((row, index) => (
                  <p key={row} className="rounded-xl bg-sky-50 p-3 text-sm font-bold text-slate-700">#{index + 1} {row}</p>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>
    </>
  )
}
