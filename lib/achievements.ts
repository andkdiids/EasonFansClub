import { prisma } from '@/lib/prisma'

export const rarityText: Record<string, string> = {
  NORMAL: '普通',
  RARE: '稀有',
  EPIC: '史诗',
  LEGENDARY: '传说',
  LIMITED: '限定',
}

export const categoryText: Record<string, string> = {
  REGISTER: '注册成就',
  CHECKIN_STREAK: '连续挂号',
  CHECKIN_TOTAL: '累计挂号',
  POST: '发帖成就',
  MUSIC: 'EasMusic 成就',
  FRIEND: '好友成就',
  ACTIVE: '活跃成就',
  SPECIAL: '特殊成就',
}

export async function getUserAchievementStats(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      _count: {
        select: {
          posts: { where: { isDeleted: false } },
          checkIns: true,
          musicPlayRecords: true,
          friendshipsA: true,
          friendshipsB: true,
        },
      },
    },
  })
  if (!user) return null

  const listen = await prisma.musicPlayRecord.aggregate({
    where: { userId },
    _sum: { durationSeconds: true },
  })
  const activeDays = Math.max(0, Math.floor((Date.now() - user.createdAt.getTime()) / 86400000))

  return {
    registered: 1,
    profileCompleted: user.profile?.bio || user.profile?.avatarUrl || user.email || user.phone ? 1 : 0,
    uidAssigned: user.uid ? 1 : 0,
    checkinStreak: user.consecutiveDays,
    checkinTotal: user._count.checkIns,
    postTotal: user._count.posts,
    listenHours: Math.floor((listen._sum.durationSeconds || 0) / 3600),
    playTotal: user._count.musicPlayRecords,
    friendTotal: user._count.friendshipsA + user._count.friendshipsB,
    activeDays,
  }
}

export function getProgressValue(
  conditionKey: string | null,
  stats: Awaited<ReturnType<typeof getUserAchievementStats>>,
) {
  if (!stats || !conditionKey) return 0
  return Number(stats[conditionKey as keyof typeof stats] || 0)
}

export async function syncUserAchievements(userId: string) {
  const stats = await getUserAchievementStats(userId)
  if (!stats) return []

  const achievements = await prisma.achievement.findMany({
    where: { isVisible: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })

  return Promise.all(
    achievements.map(async (achievement) => {
      const progress = getProgressValue(achievement.conditionKey, stats)
      const target = achievement.conditionValue || 1
      const shouldUnlock = achievement.isAutoGrant && progress >= target
      const existing = await prisma.userAchievement.findUnique({
        where: { userId_achievementId: { userId, achievementId: achievement.id } },
        select: { unlocked: true, unlockedAt: true },
      })

      return prisma.userAchievement.upsert({
        where: { userId_achievementId: { userId, achievementId: achievement.id } },
        update: {
          progress,
          unlocked: existing?.unlocked || shouldUnlock,
          unlockedAt: existing?.unlockedAt || (shouldUnlock ? new Date() : null),
        },
        create: {
          userId,
          achievementId: achievement.id,
          progress,
          unlocked: shouldUnlock,
          unlockedAt: shouldUnlock ? new Date() : null,
        },
        include: { achievement: true },
      })
    }),
  )
}
