import { Prisma, type WantListenMode } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import {
  compareWantListenScores,
  getWantListenPeriod,
  parseWantListenLeaderboardPeriod,
  type WantListenLeaderboardPeriodType,
} from '@/lib/want-listen-period'
import { normalizeWantListenMaxStreak } from '@/lib/want-listen-score'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import {
  getGameRankingTodayKey,
  resolveGameRankingRange,
  type GameRankingRange,
} from '@/lib/game-ranking-range'

type Database = Prisma.TransactionClient | typeof prisma

type WantListenScore = {
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  completionTimeMs: number
  achievedAt: Date
}

type WantListenLeaderboardKey = {
  userId: string
  mode: WantListenMode
  periodType: 'DAY' | 'WEEK' | 'ALL'
  periodKey: string
}

function wantListenBetterThanCandidateWhere(
  key: WantListenLeaderboardKey,
  candidate: WantListenScore,
): Prisma.WantListenLeaderboardEntryWhereInput {
  return {
    ...key,
    OR: [
      { score: { lt: candidate.score } },
      { score: candidate.score, correctCount: { lt: candidate.correctCount } },
      {
        score: candidate.score,
        correctCount: candidate.correctCount,
        maxStreak: { lt: candidate.maxStreak },
      },
      {
        score: candidate.score,
        correctCount: candidate.correctCount,
        maxStreak: candidate.maxStreak,
        completionTimeMs: { gt: candidate.completionTimeMs },
      },
      {
        score: candidate.score,
        correctCount: candidate.correctCount,
        maxStreak: candidate.maxStreak,
        completionTimeMs: candidate.completionTimeMs,
        achievedAt: { gt: candidate.achievedAt },
      },
    ],
  }
}

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function writeWantListenLeaderboardEntry(
  database: Database,
  key: WantListenLeaderboardKey,
  sessionId: string,
  score: WantListenScore,
) {
  const betterThanCandidateWhere = wantListenBetterThanCandidateWhere(key, score)
  const updateData = { sessionId, ...score }
  const updated = await database.wantListenLeaderboardEntry.updateMany({
    where: betterThanCandidateWhere,
    data: updateData,
  })
  if (updated.count > 0) return

  try {
    await database.wantListenLeaderboardEntry.create({
      data: { ...key, sessionId, ...score },
    })
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error
    // Another request won the first insert. Re-evaluate the same atomic
    // condition against its committed row so a lower score cannot replace it.
    await database.wantListenLeaderboardEntry.updateMany({
      where: betterThanCandidateWhere,
      data: updateData,
    })
  }
}

export async function recordWantListenLeaderboard(sessionId: string, database: Database = prisma) {
  const session = await database.wantListenSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, mode: true, status: true, score: true, correctCount: true, maxStreak: true, totalQuestions: true, completionTimeMs: true, completedAt: true, antiCheatStatus: true, excludedFromLeaderboard: true },
  })
  if (!session || session.status !== 'COMPLETED' || !session.completedAt || session.completionTimeMs === null) return
  // 只有 antiCheatStatus = CLEAN 且未被管理员排除的成绩才进入排行榜
  if (session.antiCheatStatus !== 'CLEAN') return
  if (session.excludedFromLeaderboard) return

  const score: WantListenScore = {
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    totalQuestions: session.totalQuestions,
    completionTimeMs: session.completionTimeMs,
    achievedAt: session.completedAt,
  }

  for (const periodType of ['DAY', 'WEEK', 'ALL'] as const) {
    const period = getWantListenPeriod(periodType, session.completedAt)
    await writeWantListenLeaderboardEntry(
      database,
      {
        userId: session.userId,
        mode: session.mode,
        periodType,
        periodKey: period.periodKey,
      },
      session.id,
      score,
    )
  }
}

type LeaderboardUser = {
  id: string
  uid: number
  nickname: string
  avatarUrl: string | null
  nicknameModerationStatus: string
  nicknameViolationDisplay: string | null
  Profile: { displayName: string | null; displayNameModerationStatus: string; avatarUrl: string | null } | null
}

type LeaderboardRow = {
  id: string
  userId: string
  mode: WantListenMode
  score: number
  correctCount: number
  maxStreak: number | null
  totalQuestions: number
  completionTimeMs: number
  achievedAt: Date
  User: LeaderboardUser
}

function serializeLeaderboardRow(row: LeaderboardRow, rank: number, equippedBadge?: EquippedBadgeView | null) {
  const safeName = getPublicUserDisplayName(row.User)
  return {
    rank,
    id: row.id,
    userId: row.userId,
    mode: row.mode,
    score: row.score,
    correctCount: row.correctCount,
    maxStreak: row.maxStreak,
    totalQuestions: row.totalQuestions,
    completionTimeMs: row.completionTimeMs,
    achievedAt: row.achievedAt.toISOString(),
    user: {
      id: row.User.id,
      uid: row.User.uid,
      nickname: safeName,
      displayName: safeName,
      avatarUrl: publicImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl),
      equippedBadge: equippedBadge || null,
    },
  }
}

type WantListenLeaderboardQueryRow = {
  session_id: string
  user_id: string
  mode: WantListenMode
  score: number
  correct_count: number
  max_streak: number | null
  total_questions: number
  completion_time_ms: number
  completed_at: Date
  leaderboard_rank: number | bigint
  uid: number
  nickname: string
  nicknameModerationStatus: string
  nicknameViolationDisplay: string | null
  avatar_url: string | null
  profile_display_name: string | null
  profile_display_name_moderation_status: string | null
  profile_avatar_url: string | null
}

function toWantListenLeaderboardRow(row: WantListenLeaderboardQueryRow): { row: LeaderboardRow; rank: number } {
  const score = Number(row.score)
  const correctCount = Number(row.correct_count)
  return {
    rank: Number(row.leaderboard_rank),
    row: {
      id: row.session_id,
      userId: row.user_id,
      mode: row.mode,
      score,
      correctCount,
      maxStreak: normalizeWantListenMaxStreak(row.max_streak === null ? null : Number(row.max_streak), correctCount),
      totalQuestions: Number(row.total_questions),
      completionTimeMs: Number(row.completion_time_ms),
      achievedAt: row.completed_at instanceof Date ? row.completed_at : new Date(row.completed_at),
      User: {
        id: row.user_id,
        uid: Number(row.uid),
        nickname: row.nickname,
        nicknameModerationStatus: row.nicknameModerationStatus,
        nicknameViolationDisplay: row.nicknameViolationDisplay,
        avatarUrl: row.avatar_url,
        Profile: row.profile_display_name === null && row.profile_avatar_url === null
          ? null
          : {
            displayName: row.profile_display_name,
            displayNameModerationStatus: row.profile_display_name_moderation_status || '',
            avatarUrl: row.profile_avatar_url,
          },
      },
    },
  }
}

/**
 * The public leaderboard is read from completed sessions, not from the
 * leaderboard projection. This keeps every period on the same source and
 * makes an administrator exclusion effective immediately, even when a stale
 * projection row still exists. The window function selects one best session
 * per user before ranking, matching the existing single-game leaderboard
 * contract without loading a period of raw records into Node.
 */
export async function getWantListenLeaderboardSourceRows(input: {
  mode: WantListenMode
  periodKey: string
  start: Date | null
  endExclusive: Date | null
  userId?: string
  query?: string
  limit: number
}) {
  const periodFilter = input.start && input.endExclusive
    ? Prisma.sql`AND s.completedAt >= ${input.start} AND s.completedAt < ${input.endExclusive}`
    : Prisma.empty
  const query = input.query?.trim().slice(0, 80) || ''
  const numericQuery = /^\d+$/.test(query) ? Number(query) : -1
  const userFilter = query
    ? Prisma.sql`(u.uid = ${numericQuery} OR u.nickname LIKE ${`%${query}%`} OR u.username LIKE ${`%${query}%`})`
    : Prisma.empty
  const resultFilter = query
    ? userFilter
    : Prisma.sql`(ranked.leaderboard_rank <= ${input.limit} OR ranked.user_id = ${input.userId || ''})`

  const selectedRows = await prisma.$queryRaw<WantListenLeaderboardQueryRow[]>(Prisma.sql`
    WITH eligible_sessions AS (
      SELECT
        s.id AS session_id,
        s.userId AS user_id,
        s.mode,
        s.score,
        s.correctCount AS correct_count,
        s.maxStreak AS max_streak,
        s.totalQuestions AS total_questions,
        s.completionTimeMs AS completion_time_ms,
        s.completedAt AS completed_at,
        ROW_NUMBER() OVER (
          PARTITION BY s.userId
          ORDER BY
            s.score DESC,
            s.correctCount DESC,
            s.maxStreak DESC,
            s.completionTimeMs ASC,
            s.completedAt ASC,
            s.id ASC
        ) AS user_rank
      FROM \`WantListenSession\` AS s
      WHERE s.mode = ${input.mode}
        AND s.status = 'COMPLETED'
        AND s.antiCheatStatus = 'CLEAN'
        AND s.excludedFromLeaderboard = FALSE
        AND s.completedAt IS NOT NULL
        AND s.completionTimeMs IS NOT NULL
        ${periodFilter}
    ),
    best_sessions AS (
      SELECT
        session_id,
        user_id,
        mode,
        score,
        correct_count,
        max_streak,
        total_questions,
        completion_time_ms,
        completed_at
      FROM eligible_sessions
      WHERE user_rank = 1
    ),
    ranked_sessions AS (
      SELECT
        session_id,
        user_id,
        mode,
        score,
        correct_count,
        max_streak,
        total_questions,
        completion_time_ms,
        completed_at,
        ROW_NUMBER() OVER (
          ORDER BY
            score DESC,
            correct_count DESC,
            max_streak DESC,
            completion_time_ms ASC,
            completed_at ASC,
            session_id ASC
        ) AS leaderboard_rank
      FROM best_sessions
    )
    SELECT
      ranked.session_id,
      ranked.user_id,
      ranked.mode,
      ranked.score,
      ranked.correct_count,
      ranked.max_streak,
      ranked.total_questions,
      ranked.completion_time_ms,
      ranked.completed_at,
      ranked.leaderboard_rank,
      u.uid,
      u.nickname,
      u.nicknameModerationStatus,
      u.nicknameViolationDisplay,
      u.avatarUrl AS avatar_url,
      p.displayName AS profile_display_name,
      p.displayNameModerationStatus AS profile_display_name_moderation_status,
      p.avatarUrl AS profile_avatar_url
    FROM ranked_sessions AS ranked
    INNER JOIN \`User\` AS u ON u.id = ranked.user_id
      LEFT JOIN \`Profile\` AS p ON p.userId = ranked.user_id
    WHERE ${resultFilter}
    ORDER BY ranked.leaderboard_rank ASC
    LIMIT ${input.limit + 1}
  `)

  return selectedRows.map(toWantListenLeaderboardRow)
}

export async function getWantListenLeaderboard(input: {
  mode: WantListenMode
  period?: unknown
  range?: unknown
  date?: unknown
  userId?: string
  limit?: number
  now?: Date
}) {
  const now = input.now || new Date()
  const hasUnifiedRange = input.range !== undefined && input.range !== null && input.range !== ''
  let periodType: WantListenLeaderboardPeriodType
  let period: ReturnType<typeof getWantListenPeriod>
  let resolvedRange: GameRankingRange | null = null

  if (hasUnifiedRange) {
    resolvedRange = resolveGameRankingRange({ range: input.range, date: input.date, now })
    periodType = resolvedRange.key === 'date' ? 'DAY' : resolvedRange.key === 'this-month' || resolvedRange.key === 'last-month' ? 'MONTH' : 'WEEK'
    period = {
      periodKey: resolvedRange.periodKey,
      start: resolvedRange.startAt,
      end: resolvedRange.endAt,
      endExclusive: resolvedRange.endAt,
    }
  } else {
    periodType = parseWantListenLeaderboardPeriod(input.period)
    if (periodType === 'ALL') {
      period = getWantListenPeriod(periodType, now)
    } else {
      const rangeKey = periodType === 'DAY' ? 'date' : periodType === 'MONTH' ? 'this-month' : 'this-week'
      resolvedRange = resolveGameRankingRange({
        range: rangeKey,
        date: rangeKey === 'date' ? getGameRankingTodayKey(now) : undefined,
        now,
      })
      period = {
        periodKey: resolvedRange.periodKey,
        start: resolvedRange.startAt,
        end: resolvedRange.endAt,
        endExclusive: resolvedRange.endAt,
      }
    }
  }
  const limit = Math.max(1, Math.min(100, input.limit || 50))
  const rankedRows = await getWantListenLeaderboardSourceRows({
    mode: input.mode,
    periodKey: period.periodKey,
    start: period.start,
    endExclusive: period.endExclusive,
    userId: input.userId,
    limit,
  })
  const topRows = rankedRows.filter((item) => item.rank <= limit)
  const self = input.userId ? rankedRows.find((item) => item.row.userId === input.userId) || null : null
  const badgeTargets = [...topRows, ...(self && self.rank > limit ? [self] : [])]
  const equippedBadgeMap = await getEquippedBadgesForUsers(badgeTargets.map((item) => item.row.userId))
  return {
    mode: input.mode,
    period: periodType,
    periodKey: period.periodKey,
    rangeKey: resolvedRange?.key || null,
    rangeDate: resolvedRange?.date || null,
    rangeLabel: resolvedRange?.label || (periodType === 'ALL' ? '历史累计' : null),
    cacheKey: resolvedRange
      ? `want-listen:${input.mode}:${resolvedRange.cacheKey}`
      : `want-listen:${input.mode}:${periodType}:${period.periodKey}`,
    rows: topRows.map((item) => serializeLeaderboardRow(item.row, item.rank, equippedBadgeMap.get(item.row.userId) || null)),
    self: self && self.rank > limit
      ? serializeLeaderboardRow(self.row, self.rank, equippedBadgeMap.get(self.row.userId) || null)
      : null,
  }
}

export { compareWantListenScores }

/**
 * 重新聚合某用户在某模式下的全部排行榜成绩（DAY / WEEK / ALL 各自按时间范围取剩余合法 Session 的最高记录）。
 * 用于「精确删除某条成绩」后，让该用户的其他合法 Session 自动补位，而不影响其他用户 / 其他模式。
 *
 * 做法：先删除该 (userId, mode) 的全部 entry，再对每一条「仍符合条件」的 Session 重新聚合；
 * 某周期若无剩余合法 Session，则该周期的 entry 自然消失。
 */
export async function recomputeUserWantListenLeaderboard(userId: string, mode: WantListenMode, database: Database = prisma) {
  const eligibleSessions = await database.wantListenSession.findMany({
    where: {
      userId,
      mode,
      status: 'COMPLETED',
      completedAt: { not: null },
      completionTimeMs: { not: null },
      antiCheatStatus: 'CLEAN',
      excludedFromLeaderboard: false,
    },
    select: { id: true },
  })
  // 先清掉该用户该模式所有周期的成绩，再按剩余合法 Session 重新聚合（保证被排除 Session 不会残留）
  await database.wantListenLeaderboardEntry.deleteMany({ where: { userId, mode } })
  for (const session of eligibleSessions) {
    await recordWantListenLeaderboard(session.id, database)
  }
}
