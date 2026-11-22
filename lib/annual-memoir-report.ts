import type { Prisma } from '@prisma/client'
import { getMemoirAvailability } from '@/lib/annual-memoir-policy'
import { buildPublicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { collectBestGame, collectCommunityMemory, isMemoirMemoryVisible } from '@/lib/annual-memoir-moments'

async function presentSnapshot(snapshot: Awaited<ReturnType<typeof prisma.annualMemoirSnapshot.findFirst>>) {
  if (!snapshot) return null
  const payload = snapshot.payload as unknown as MemoirReport
  if (!payload.communityMemory) return snapshot
  const { kind, excerpt, date } = payload.communityMemory
  const visible = await isMemoirMemoryVisible(prisma, snapshot.userId, payload.communityMemory)
  return { ...snapshot, payload: { ...payload, communityMemory: visible ? { kind, excerpt, date } : null } }
}

export async function readMemoir(activityId: string, userId: string) {
  return presentSnapshot(await prisma.annualMemoirSnapshot.findFirst({ where: { activityId, userId } }))
}

async function collect(tx: Prisma.TransactionClient, userId: string, start: Date, end: Date) {
  const range = { gte: start, lt: end }
  const publicPost = buildPublicPostWhere(end)
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { uid: true, nickname: true, createdAt: true } })
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' })
  const [checkIns, posts, replies, likesGiven, likesReceived, friends, followers, games, badges, featuredBadge, topicApprovals, topicRegistrations, attendance, communityMemory, bestGame] = await Promise.all([
    tx.checkIn.findMany({ where: { userId, checkDate: range }, select: { checkDate: true, exp: true } }),
    tx.post.findMany({ where: { ...publicPost, authorId: userId, publishedAt: range }, select: { publishedAt: true } }),
    tx.reply.findMany({ where: { authorId: userId, createdAt: range, isDeleted: false, moderationStatus: 'NORMAL', Post: publicPost }, select: { createdAt: true } }),
    tx.like.count({ where: { userId, createdAt: range, Post: publicPost } }),
    tx.like.count({ where: { createdAt: range, Post: { ...publicPost, authorId: userId } } }),
    tx.friendship.count({ where: { createdAt: range, OR: [{ userAId: userId }, { userBId: userId }] } }),
    tx.friendFollow.count({ where: { followedId: userId, createdAt: range } }),
    tx.guessSongSession.aggregate({ where: { userId, completedAt: range, status: 'COMPLETED', isValid: true }, _count: true, _max: { score: true } }),
    tx.userBadge.count({ where: { userId, obtainedAt: range, revokedAt: null } }),
    tx.userBadge.findFirst({ where: { userId, obtainedAt: range, revokedAt: null, isHidden: false },
      orderBy: [{ obtainedAt: 'desc' }, { id: 'asc' }], select: { obtainedAt: true, Badge: { select: { name: true } } } }),
    tx.topicActivityParticipation.findMany({
      where: { userId, firstApprovedAt: range, approvedSubmissionCount: { gt: 0 }, Activity: { type: 'TOPIC_ACTIVITY' } },
      select: { activityId: true },
    }),
    tx.activityRegistration.findMany({
      where: { userId, registeredAt: range, status: 'ACTIVE', cancelledAt: null, Activity: { type: 'TOPIC_ACTIVITY' } },
      select: { activityId: true },
    }),
    tx.activityRegistration.findMany({
      where: { userId, status: 'ACTIVE', cancelledAt: null, Activity: { type: 'OFFLINE' },
        OR: [{ verifiedAt: range, OR: [{ checkInSource: { in: ['MANUAL', 'QR'] } },
          { checkInSource: null, verificationMethod: { in: ['MANUAL', 'QR'] } }] },
          { checkedInAt: range, checkInSource: { in: ['MANUAL', 'QR'] } }] },
      select: { activityId: true },
    }),
    collectCommunityMemory(tx, userId, range, formatter),
    collectBestGame(tx, userId, range),
  ])
  const dates = [...checkIns.map((row) => row.checkDate), ...posts.flatMap((row) => row.publishedAt ? [row.publishedAt] : []), ...replies.map((row) => row.createdAt)]
  const days = [...new Set(dates.map((date) => formatter.format(date)))].sort()
  const checkInDays = [...new Set(checkIns.map((row) => formatter.format(row.checkDate)))].sort()
  let run = 0
  let longestCheckInRun = 0
  let previous = Number.NEGATIVE_INFINITY
  for (const day of checkInDays) {
    const current = Date.parse(day)
    run = current - previous === 86_400_000 ? run + 1 : 1
    longestCheckInRun = Math.max(longestCheckInRun, run)
    previous = current
  }
  const title = posts.length >= 5 ? '故事记录者' : friends >= 3 ? '最佳损友' : games._count >= 5 ? '游戏冒险家' : badges >= 3 ? '勋章收藏家' : days.length ? '默默陪伴者' : '故事刚刚开始'
  return {
    nickname: user.nickname, uid: user.uid, registered: formatter.format(user.createdAt),
    firstRecordedDay: days[0] ?? null, activeDays: days.length,
    checkIns: checkInDays.length, longestCheckInRun,
    checkInExperience: checkIns.reduce((sum, row) => sum + row.exp, 0),
    posts: posts.length, replies: replies.length, likesGiven, likesReceived, friends, followers,
    games: games._count, bestScore: games._max.score, badges, featuredBadge: featuredBadge?.Badge.name ?? null, featuredBadgeDate: featuredBadge ? formatter.format(featuredBadge.obtainedAt) : null,
    communityMemory, bestGame,
    // Live leaderboard entries are mutable and do not record official settlements.
    monthlyFirsts: null, weeklyFirsts: null,
    topics: new Set([...topicApprovals, ...topicRegistrations].map((row) => row.activityId)).size,
    offlineMeetups: new Set(attendance.map((row) => row.activityId)).size, title,
    message: '等到葡萄成熟时，才发现这一年，原来已经这么甜。',
  }
}

export type MemoirReport = Awaited<ReturnType<typeof collect>>

export async function generateMemoir(activityId: string, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT activityId FROM AnnualMemoirConfig WHERE activityId = ${activityId} FOR UPDATE`
    const config = await tx.annualMemoirConfig.findUnique({
      where: { activityId }, include: { activity: true },
    })
    if (!config) return null
    const existing = await tx.annualMemoirSnapshot.findUnique({ where: { userId_year: { userId, year: config.year } } })
    if (existing) return existing.activityId === activityId ? existing : null
    const now = new Date()
    const configuredAndPublished = config.enabled && config.activity.type === 'TOPIC_ACTIVITY' &&
      config.activity.status === 'PUBLISHED' && !!config.activity.coverUrl &&
      !!config.annualBadgeId && config.reservationPoints >= 0
    if (!getMemoirAvailability({ configuredAndPublished, schedule: config, now, hasSnapshot: false }).canGenerate) return null
    const payload = await collect(tx, userId, config.statisticsStartAt, config.statisticsEndAt)
    const snapshot = await tx.annualMemoirSnapshot.create({
      data: { activityId, userId, year: config.year, templateVersion: config.templateVersion,
        statisticsStartAt: config.statisticsStartAt, statisticsEndAt: config.statisticsEndAt,
        createdAt: now, payload },
    })
    if (!config.statisticsLockedAt) await tx.annualMemoirConfig.update({ where: { activityId }, data: { statisticsLockedAt: now } })
    return snapshot
  }, { timeout: 20_000 })
  return presentSnapshot(result)
}
