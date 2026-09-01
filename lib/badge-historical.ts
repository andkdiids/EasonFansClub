import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-constants'
import { calculateCheckinStreaks } from '@/lib/checkin'
import { accountAgeDays, VALID_POST_WHERE } from '@/lib/badge-metrics'
import { BADGE_RULE_REGISTRY, type SupportedBadgeRuleType } from '@/lib/badge-rules'
import { prisma } from '@/lib/prisma'

export type HistoricalQualificationWindow = {
  from: Date
  until: Date
}

export type HistoricalMetricUser = {
  id: string
  createdAt: Date
}

export type HistoricalBackfillCapability = {
  supported: boolean
  basis: string
}

export function getHistoricalBackfillCapability(ruleType: SupportedBadgeRuleType): HistoricalBackfillCapability {
  const definition = BADGE_RULE_REGISTRY[ruleType]
  return {
    supported: definition.supportsHistoricalBackfill,
    basis: definition.historicalBasis,
  }
}

export function getHistoricalQualificationWindow(input: { availableFrom: Date | null; availableUntil: Date | null }, now = new Date()): HistoricalQualificationWindow {
  return {
    from: input.availableFrom || new Date(0),
    until: input.availableUntil && input.availableUntil.getTime() < now.getTime() ? input.availableUntil : now,
  }
}

function createMetricMap(users: readonly HistoricalMetricUser[]) {
  return new Map(users.map((user) => [user.id, 0]))
}

function timeRange(window: HistoricalQualificationWindow) {
  return { gte: window.from, lte: window.until }
}

/**
 * Rebuild a rule metric from facts that carry a trustworthy timestamp. This
 * intentionally rejects unsupported rules instead of substituting today's
 * aggregate and pretending it was true during the limited period.
 */
export async function getBatchHistoricalBadgeMetrics(
  users: readonly HistoricalMetricUser[],
  ruleType: SupportedBadgeRuleType,
  configJson: unknown,
  window: HistoricalQualificationWindow,
) {
  const capability = getHistoricalBackfillCapability(ruleType)
  if (!capability.supported) throw new Error(`该规则无法可靠判断限定期历史资格：${capability.basis}`)

  const userIds = users.map((user) => user.id)
  const metrics = createMetricMap(users)
  if (!userIds.length) return metrics
  const createdAt = timeRange(window)

  switch (ruleType) {
    case 'POST_COUNT': {
      const rows = await prisma.post.groupBy({ by: ['authorId'], where: { authorId: { in: userIds }, ...VALID_POST_WHERE, createdAt }, _count: { _all: true } })
      rows.forEach((row) => metrics.set(row.authorId, row._count._all))
      return metrics
    }
    case 'CHECKIN_TOTAL_DAYS': {
      const rows = await prisma.checkIn.findMany({ where: { userId: { in: userIds }, checkDate: createdAt }, select: { userId: true, checkinDateKey: true } })
      const dates = new Map<string, Set<string>>()
      rows.forEach((row) => {
        const values = dates.get(row.userId) || new Set<string>()
        values.add(row.checkinDateKey)
        dates.set(row.userId, values)
      })
      dates.forEach((values, userId) => metrics.set(userId, values.size))
      return metrics
    }
    case 'CHECKIN_STREAK': {
      const rows = await prisma.checkIn.findMany({ where: { userId: { in: userIds }, checkDate: createdAt }, select: { userId: true, checkinDateKey: true } })
      const dates = new Map<string, string[]>()
      rows.forEach((row) => dates.set(row.userId, [...(dates.get(row.userId) || []), row.checkinDateKey]))
      users.forEach((user) => metrics.set(user.id, calculateCheckinStreaks(dates.get(user.id) || [], window.until).longestStreak))
      return metrics
    }
    case 'ACCOUNT_AGE_DAYS':
      users.forEach((user) => metrics.set(user.id, accountAgeDays(user.createdAt, window.until)))
      return metrics
    case 'GUESS_SONG_MAX_STREAK': {
      const rows = await prisma.guessSongSession.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, status: 'COMPLETED', completedAt: createdAt, isValid: true, riskScore: { lt: GUESS_SONG_RISK_THRESHOLD } },
        _max: { maxStreak: true },
      })
      rows.forEach((row) => metrics.set(row.userId, typeof row._max.maxStreak === 'number' ? Math.max(0, row._max.maxStreak) : 0))
      return metrics
    }
    case 'CONCERT_ATTENDANCE_COUNT': {
      const rows = await prisma.userMusicConcert.groupBy({ by: ['userId'], where: { userId: { in: userIds }, createdAt }, _count: { _all: true } })
      rows.forEach((row) => metrics.set(row.userId, row._count._all))
      return metrics
    }
    case 'CONCERT_SHOW_ATTENDED':
    case 'CONCERT_TOUR_ATTENDED': {
      const config = configJson && typeof configJson === 'object' && !Array.isArray(configJson) ? configJson as { concertId?: unknown; tourId?: unknown } : null
      const rows = await prisma.userMusicConcert.findMany({
        where: {
          userId: { in: userIds },
          createdAt,
          ...(ruleType === 'CONCERT_SHOW_ATTENDED'
            ? { concertId: typeof config?.concertId === 'string' ? config.concertId : '__invalid__' }
            : { MusicConcert: { tourId: typeof config?.tourId === 'string' ? config.tourId : '__invalid__' } }),
        },
        select: { userId: true },
      })
      rows.forEach((row) => metrics.set(row.userId, 1))
      return metrics
    }
    case 'RATING_COUNT': {
      const rows = await prisma.rating.groupBy({ by: ['userId'], where: { userId: { in: userIds }, createdAt }, _count: { _all: true } })
      rows.forEach((row) => metrics.set(row.userId, row._count._all))
      return metrics
    }
    case 'FEATURED_POST_COUNT':
    case 'FRIEND_COUNT':
    case 'FOLLOWER_COUNT':
    case 'DUEL_WIN_COUNT':
    case 'WANT_LISTEN_MAX_STREAK':
    case 'BADGE_SERIES_COMPLETE':
    case 'ACTIVITY_PARTICIPATION':
      throw new Error(`该规则无法可靠判断限定期历史资格：${capability.basis}`)
  }
  return metrics
}
