import { calculateCheckinStreaks } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'

export type AchievementSyncCategory =
  | 'REGISTER'
  | 'CHECKIN_STREAK'
  | 'CHECKIN_TOTAL'
  | 'POST'
  | 'MUSIC'
  | 'FRIEND'
  | 'ACTIVE'
  | 'SPECIAL'

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
      checkIns: { select: { checkinDateKey: true } },
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
  // 连续挂号成就按签到记录重算,不读用户表上的连续天数快照
  const checkinStreaks = calculateCheckinStreaks(user.checkIns.map((item) => item.checkinDateKey))

  return {
    registered: 1,
    profileCompleted: user.profile?.bio || user.profile?.avatarUrl || user.email || user.phone ? 1 : 0,
    uidAssigned: user.uid ? 1 : 0,
    checkinStreak: checkinStreaks.currentStreak,
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

export async function syncUserAchievements(userId: string, categories?: AchievementSyncCategory[]) {
  const stats = await getUserAchievementStats(userId)
  if (!stats) return []

  const achievements = await prisma.achievement.findMany({
    where: { isVisible: true, ...(categories?.length ? { category: { in: categories } } : {}) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  })

  const existingRecords = await prisma.userAchievement.findMany({
    where: { userId, achievementId: { in: achievements.map((achievement) => achievement.id) } },
  })
  const existingByAchievementId = new Map(existingRecords.map((record) => [record.achievementId, record]))

  for (const achievement of achievements) {
    const progress = getProgressValue(achievement.conditionKey, stats)
    const target = achievement.conditionValue || 1
    const shouldUnlock = achievement.isAutoGrant && progress >= target
    const existing = existingByAchievementId.get(achievement.id)
    const unlocked = existing?.unlocked || shouldUnlock
    const unlockedAt = existing?.unlockedAt || (shouldUnlock ? new Date() : null)

    if (
      existing &&
      existing.progress === progress &&
      existing.unlocked === unlocked &&
      existing.unlockedAt?.getTime() === unlockedAt?.getTime()
    ) {
      continue
    }

    await prisma.userAchievement.upsert({
      where: { userId_achievementId: { userId, achievementId: achievement.id } },
      update: {
        progress,
        unlocked,
        unlockedAt,
      },
      create: {
        userId,
        achievementId: achievement.id,
        progress,
        unlocked,
        unlockedAt,
      },
    })
  }

  if (categories?.length) {
    return []
  }

  return prisma.userAchievement.findMany({
    where: { userId, achievement: { isVisible: true } },
    include: { achievement: true },
    orderBy: [{ unlockedAt: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })
}
