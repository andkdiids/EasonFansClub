import { calculateCheckinStreaks, getShanghaiDateKey, parseBeijingDate } from '@/lib/checkin'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-constants'
import { prisma } from '@/lib/prisma'
import { BADGE_RULE_REGISTRY, type SupportedBadgeRuleType } from '@/lib/badge-rules'

export const VALID_POST_WHERE = {
  status: 'PUBLISHED' as const,
  isDeleted: false,
  moderationStatus: 'APPROVED' as const,
}

export const ACTIVE_RELATION_USER_WHERE = {
  status: 'ACTIVE' as const,
  isDeleted: false,
}

export function safeMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function accountAgeDays(createdAt: Date, now = new Date()) {
  const created = parseBeijingDate(getShanghaiDateKey(createdAt))
  const today = parseBeijingDate(getShanghaiDateKey(now))
  if (!created || !today) return Math.max(0, Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000))
  return Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86_400_000))
}

type BadgeMetricLoader = (userId: string) => Promise<number>

const BADGE_RULE_METRIC_LOADERS: Record<SupportedBadgeRuleType, BadgeMetricLoader> = {
  POST_COUNT: (userId) => prisma.post.count({ where: { authorId: userId, ...VALID_POST_WHERE } }),
  FEATURED_POST_COUNT: (userId) => prisma.post.count({ where: { authorId: userId, isFeatured: true, ...VALID_POST_WHERE } }),
  CHECKIN_TOTAL_DAYS: async (userId) => {
    const rows = await prisma.checkIn.findMany({ where: { userId }, select: { checkinDateKey: true } })
    return new Set(rows.map((row) => row.checkinDateKey)).size
  },
  CHECKIN_STREAK: async (userId) => {
    const rows = await prisma.checkIn.findMany({ where: { userId }, select: { checkinDateKey: true } })
    return calculateCheckinStreaks(rows.map((row) => row.checkinDateKey)).currentStreak
  },
  ACCOUNT_AGE_DAYS: async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } })
    return user ? accountAgeDays(user.createdAt) : 0
  },
  FRIEND_COUNT: (userId) => prisma.friendship.count({
    where: {
      OR: [{ userAId: userId }, { userBId: userId }],
      User_Friendship_userAIdToUser: ACTIVE_RELATION_USER_WHERE,
      User_Friendship_userBIdToUser: ACTIVE_RELATION_USER_WHERE,
    },
  }),
  FOLLOWER_COUNT: (userId) => prisma.follow.count({
    where: {
      followingId: userId,
      User_Follow_followerIdToUser: ACTIVE_RELATION_USER_WHERE,
      User_Follow_followingIdToUser: ACTIVE_RELATION_USER_WHERE,
    },
  }),
  GUESS_SONG_MAX_STREAK: async (userId) => {
    const result = await prisma.guessSongSession.aggregate({
      where: {
        userId,
        status: 'COMPLETED',
        completedAt: { not: null },
        isValid: true,
        riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
      },
      _max: { maxStreak: true },
    })
    return safeMetric(result._max.maxStreak)
  },
  DUEL_WIN_COUNT: async (userId) => {
    const result = await prisma.guessSongDuelStats.findUnique({ where: { userId }, select: { wins: true } })
    return safeMetric(result?.wins)
  },
  WANT_LISTEN_MAX_STREAK: async (userId) => {
    const result = await prisma.wantListenStats.aggregate({ where: { userId }, _max: { maxStreak: true } })
    return safeMetric(result._max.maxStreak)
  },
  CONCERT_ATTENDANCE_COUNT: (userId) => prisma.userMusicConcert.count({ where: { userId } }),
  // Targeted show/tour rules require configJson and are evaluated by the
  // config-aware concert evaluator, never by this scalar loader.
  CONCERT_SHOW_ATTENDED: async () => 0,
  CONCERT_TOUR_ATTENDED: async () => 0,
  RATING_COUNT: (userId) => prisma.rating.count({ where: { userId } }),
  // Series completion is evaluated from Badge ownership, not from a numeric
  // user metric. Keeping a guarded loader here preserves the single registry
  // shape while the rule engine handles this special rule explicitly.
  BADGE_SERIES_COMPLETE: async () => 0,
  // Activity participation is evaluated by the shared activity qualification
  // service because its metric depends on a configured activityId and the
  // check-in source/time window, not on a scalar user counter.
  ACTIVITY_PARTICIPATION: async () => 0,
  // Ownership rules use a config-aware, active UserBadge query rather than a
  // scalar metric. The rule engine calls that evaluator directly.
  BADGE_OWNERSHIP: async () => 0,
  // Birthday/zodiac qualification is a typed month/day predicate handled by
  // evaluateBadgeRule; these scalar loaders are intentionally inert.
  BIRTHDAY_ZODIAC: async () => 0,
  BIRTHDAY_TODAY: async () => 0,
}

export function getBadgeMetricLoader(ruleType: SupportedBadgeRuleType) {
  const loaderKey = BADGE_RULE_REGISTRY[ruleType].metricLoader as SupportedBadgeRuleType
  return BADGE_RULE_METRIC_LOADERS[loaderKey]
}

export async function getUserBadgeMetric(userId: string, ruleType: SupportedBadgeRuleType) {
  return getBadgeMetricLoader(ruleType)(userId)
}
