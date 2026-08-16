import { calculateCheckinStreaks } from '@/lib/checkin'
import { prisma } from '@/lib/prisma'
import { awardRegistrationFee, HUNDRED_DAY_RECORD_REWARD } from '@/lib/registration-fee'
import { DUEL_ACHIEVEMENT_CONFIG } from '@/lib/guess-song-duel-config'

export type AchievementSyncCategory =
  | 'REGISTER'
  | 'CHECKIN_STREAK'
  | 'CHECKIN_TOTAL'
  | 'POST'
  | 'MUSIC'
  | 'FRIEND'
  | 'ACTIVE'
  | 'DUEL'
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
  DUEL: '听听·对决',
  SPECIAL: '特殊成就',
}

export async function getUserAchievementStats(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      Profile: true,
      GuessSongDuelStats: { select: { wins: true, participations: true } },
      WantListenStats: { select: { mode: true, totalCorrect: true, perfectGames: true, maxStreak: true, silentMaxStreak: true } },
      UndercoverStats: { select: { undercoverWins: true, undercoverSurvivalWins: true, undercoverGuessWins: true, successfulUndercoverVotes: true } },
      CheckIn: { select: { checkinDateKey: true } },
      _count: {
        select: {
          Post: { where: { isDeleted: false } },
          CheckIn: true,
          MusicPlayRecord: true,
          Friendship_Friendship_userAIdToUser: true,
          Friendship_Friendship_userBIdToUser: true,
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
  const checkinStreaks = calculateCheckinStreaks(user.CheckIn.map((item) => item.checkinDateKey))
  const wantListenCorrectTotal = user.WantListenStats.reduce((sum, item) => sum + item.totalCorrect, 0)
  const cantonesePerfectGames = user.WantListenStats.find((item) => item.mode === 'CANTONESE_FRAGMENT')?.perfectGames || 0
  const falseTitleMaxStreak = user.WantListenStats.find((item) => item.mode === 'FALSE_TITLE')?.maxStreak || 0
  const wantListenSilentMaxStreak = user.WantListenStats.find((item) => item.mode === 'WANT_LISTEN')?.silentMaxStreak || 0

  return {
    registered: 1,
    profileCompleted: user.Profile?.bio || user.Profile?.avatarUrl || user.email || user.phone ? 1 : 0,
    uidAssigned: user.uid ? 1 : 0,
    checkinStreak: checkinStreaks.currentStreak,
    checkinTotal: user._count.CheckIn,
    postTotal: user._count.Post,
    listenHours: Math.floor((listen._sum.durationSeconds || 0) / 3600),
    playTotal: user._count.MusicPlayRecord,
    friendTotal: user._count.Friendship_Friendship_userAIdToUser + user._count.Friendship_Friendship_userBIdToUser,
    duelWins: user.GuessSongDuelStats?.wins || 0,
    duelParticipations: user.GuessSongDuelStats?.participations || 0,
    wantListenCorrectTotal,
    cantonesePerfectGames,
    falseTitleMaxStreak,
    wantListenSilentMaxStreak,
    undercoverWins: user.UndercoverStats?.undercoverWins || 0,
    undercoverSurvivalWins: user.UndercoverStats?.undercoverSurvivalWins || 0,
    undercoverGuessWins: user.UndercoverStats?.undercoverGuessWins || 0,
    successfulUndercoverVotes: user.UndercoverStats?.successfulUndercoverVotes || 0,
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

  if (!categories?.length || categories.includes('CHECKIN_STREAK')) {
    await prisma.achievement.upsert({
      where: { slug: 'checkin-streak-100' },
      update: {
        title: '百日病历',
        description: `连续挂号 100 天，解锁百日病历徽章、专属称号及 ${HUNDRED_DAY_RECORD_REWARD} 挂号费奖励。`,
        icon: '📋',
        category: 'CHECKIN_STREAK',
        rarity: 'LEGENDARY',
        conditionKey: 'checkinStreak',
        conditionValue: 100,
        isAutoGrant: true,
        isVisible: true,
        sortOrder: 13,
      },
      create: {
        title: '百日病历',
        slug: 'checkin-streak-100',
        description: `连续挂号 100 天，解锁百日病历徽章、专属称号及 ${HUNDRED_DAY_RECORD_REWARD} 挂号费奖励。`,
        icon: '📋',
        category: 'CHECKIN_STREAK',
        rarity: 'LEGENDARY',
        conditionKey: 'checkinStreak',
        conditionValue: 100,
        isAutoGrant: true,
        isVisible: true,
        sortOrder: 13,
      },
    })
  }

  if (!categories?.length || categories.includes('DUEL')) {
    for (const config of DUEL_ACHIEVEMENT_CONFIG) {
      await prisma.achievement.upsert({
        where: { slug: config.slug },
        update: {
          title: config.title,
          description: config.description,
          icon: config.icon,
          category: 'DUEL',
          rarity: 'EPIC',
          conditionKey: config.conditionKey,
          conditionValue: config.conditionValue,
          isAutoGrant: true,
          isVisible: true,
          sortOrder: config.sortOrder,
        },
        create: {
          slug: config.slug,
          title: config.title,
          description: config.description,
          icon: config.icon,
          category: 'DUEL',
          rarity: 'EPIC',
          conditionKey: config.conditionKey,
          conditionValue: config.conditionValue,
          isAutoGrant: true,
          isVisible: true,
          sortOrder: config.sortOrder,
        },
      })
    }
  }

  if (!categories?.length || categories.includes('SPECIAL')) {
    const wantListenAchievements = [
      { slug: 'want-listen-correct-100', title: '此时无声胜有声', description: '想听三个模式累计答对 100 题。', icon: '🔇', conditionKey: 'wantListenCorrectTotal', conditionValue: 100, sortOrder: 70 },
      { slug: 'want-listen-cantonese-perfect', title: '歌词本', description: '粤语残片单局 20/20。', icon: '📖', conditionKey: 'cantonesePerfectGames', conditionValue: 1, sortOrder: 71 },
      { slug: 'want-listen-false-title-streak-27', title: '真的假不了', description: '防不胜防累计连续答对 27 题。', icon: '🧩', conditionKey: 'falseTitleMaxStreak', conditionValue: 27, sortOrder: 72 },
      { slug: 'want-listen-silent-streak-10', title: '不用听了', description: '想听连续 10 题答对且未开启第 4 层歌词提示。', icon: '🤫', conditionKey: 'wantListenSilentMaxStreak', conditionValue: 10, sortOrder: 73 },
      { slug: 'undercover-star-acting', title: '演技派', description: '作为卧底首次获胜。', icon: '🎭', conditionKey: 'undercoverWins', conditionValue: 1, sortOrder: 74 },
      { slug: 'undercover-star-best', title: '全场最佳', description: '作为卧底存活到最后两人并获胜。', icon: '⭐', conditionKey: 'undercoverSurvivalWins', conditionValue: 1, sortOrder: 75 },
      { slug: 'undercover-star-turnaround', title: '反客为主', description: '卧底被投出后猜中平民词并翻盘。', icon: '🔄', conditionKey: 'undercoverGuessWins', conditionValue: 1, sortOrder: 76 },
      { slug: 'undercover-star-eagle-eye', title: '火眼金睛', description: '作为平民累计参与成功淘汰卧底 10 次。', icon: '🔎', conditionKey: 'successfulUndercoverVotes', conditionValue: 10, sortOrder: 77 },
    ] as const
    for (const config of wantListenAchievements) {
      await prisma.achievement.upsert({
        where: { slug: config.slug },
        update: {
          title: config.title,
          description: config.description,
          icon: config.icon,
          category: 'SPECIAL',
          rarity: 'EPIC',
          conditionKey: config.conditionKey,
          conditionValue: config.conditionValue,
          isAutoGrant: true,
          isVisible: true,
          sortOrder: config.sortOrder,
        },
        create: {
          slug: config.slug,
          title: config.title,
          description: config.description,
          icon: config.icon,
          category: 'SPECIAL',
          rarity: 'EPIC',
          conditionKey: config.conditionKey,
          conditionValue: config.conditionValue,
          isAutoGrant: true,
          isVisible: true,
          sortOrder: config.sortOrder,
        },
      })
    }
  }

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

    await prisma.$transaction(async (tx) => {
      await tx.userAchievement.upsert({
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
      if (achievement.slug === 'checkin-streak-100' && shouldUnlock) {
        await awardRegistrationFee(tx, {
          userId,
          requestedAmount: HUNDRED_DAY_RECORD_REWARD,
          action: 'ACTIVITY_REWARD',
          reason: '“百日病历”成就一次性奖励',
          businessKey: `achievement-reward:${userId}:${achievement.id}`,
        })
      }
    })
  }

  if (categories?.length) {
    return []
  }

  return prisma.userAchievement.findMany({
    where: { userId, Achievement: { isVisible: true } },
    include: { Achievement: true },
    orderBy: [{ unlockedAt: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  })
}
