import { Prisma, type WantListenMode } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import {
  compareWantListenScores,
  getWantListenPeriod,
  parseWantListenLeaderboardPeriod,
} from '@/lib/want-listen-period'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'

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
  maxStreak: number
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

type MonthlyLeaderboardQueryRow = {
  session_id: string
  user_id: string
  mode: WantListenMode
  score: number
  correct_count: number
  max_streak: number
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

function toMonthlyLeaderboardRow(row: MonthlyLeaderboardQueryRow): { row: LeaderboardRow; rank: number } {
  return {
    rank: Number(row.leaderboard_rank),
    row: {
      id: row.session_id,
      userId: row.user_id,
      mode: row.mode,
      score: row.score,
      correctCount: row.correct_count,
      maxStreak: row.max_streak,
      totalQuestions: row.total_questions,
      completionTimeMs: row.completion_time_ms,
      achievedAt: row.completed_at,
      User: {
        id: row.user_id,
        uid: row.uid,
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
 * Monthly records are resolved from the existing timestamped sessions. The
 * window function selects one best session per user before ranking, matching
 * the existing score / correct / streak / time / achieved-at rule without
 * loading a month of raw records into Node or introducing a MONTH enum.
 */
async function getMonthlyWantListenLeaderboard(input: {
  mode: WantListenMode
  periodKey: string
  start: Date
  endExclusive: Date
  userId?: string
  limit: number
}) {
  const selectedRows = await prisma.$queryRaw<MonthlyLeaderboardQueryRow[]>(Prisma.sql`
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
        AND s.completionTimeMs IS NOT NULL
        AND s.completedAt >= ${input.start}
        AND s.completedAt < ${input.endExclusive}
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
    WHERE ranked.leaderboard_rank <= ${input.limit} OR ranked.user_id = ${input.userId || ''}
    ORDER BY ranked.leaderboard_rank ASC
    LIMIT ${input.limit + 1}
  `)

  const rankedRows = selectedRows.map(toMonthlyLeaderboardRow)
  const topRows = rankedRows.filter((item) => item.rank <= input.limit)
  const ownRow = input.userId ? rankedRows.find((item) => item.row.userId === input.userId) || null : null
  const badgeTargets = [...topRows, ...(ownRow && ownRow.rank > input.limit ? [ownRow] : [])]
  const equippedBadgeMap = await getEquippedBadgesForUsers(badgeTargets.map((item) => item.row.userId))

  return {
    mode: input.mode,
    period: 'MONTH' as const,
    periodKey: input.periodKey,
    rows: topRows.map((item) => serializeLeaderboardRow(item.row, item.rank, equippedBadgeMap.get(item.row.userId) || null)),
    self: ownRow && ownRow.rank > input.limit
      ? serializeLeaderboardRow(ownRow.row, ownRow.rank, equippedBadgeMap.get(ownRow.row.userId) || null)
      : null,
  }
}

export async function getWantListenLeaderboard(input: {
  mode: WantListenMode
  period?: unknown
  userId?: string
  limit?: number
  now?: Date
}) {
  const periodType = parseWantListenLeaderboardPeriod(input.period)
  const period = getWantListenPeriod(periodType, input.now)
  const limit = Math.max(1, Math.min(100, input.limit || 50))
  if (periodType === 'MONTH') {
    if (!period.start || !period.endExclusive) throw new Error('MONTH 周期必须有完整时间范围')
    return getMonthlyWantListenLeaderboard({
      mode: input.mode,
      periodKey: period.periodKey,
      start: period.start,
      endExclusive: period.endExclusive,
      userId: input.userId,
      limit,
    })
  }
  const where = {
    mode: input.mode,
    periodType,
    periodKey: period.periodKey,
    // 只有 antiCheatStatus = CLEAN 且未被管理员排除的场次才进入排行榜
    WantListenSession: { is: { antiCheatStatus: 'CLEAN' as const, excludedFromLeaderboard: false } },
  }
  const rows = await prisma.wantListenLeaderboardEntry.findMany({
    where,
    orderBy: [
      { score: 'desc' },
      { correctCount: 'desc' },
      { maxStreak: 'desc' },
      { completionTimeMs: 'asc' },
      { achievedAt: 'asc' },
      { id: 'asc' },
    ],
    take: limit,
    include: {
      User: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          avatarUrl: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
    },
  })

  const self = input.userId
    ? await prisma.wantListenLeaderboardEntry.findFirst({
      where: {
        userId: input.userId,
        mode: input.mode,
        periodType,
        periodKey: period.periodKey,
        WantListenSession: { is: { antiCheatStatus: 'CLEAN' as const, excludedFromLeaderboard: false } },
      },
      include: {
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            avatarUrl: true,
            nicknameModerationStatus: true,
            nicknameViolationDisplay: true,
            Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
          },
        },
      },
    })
    : null

  const equippedBadgeMap = await getEquippedBadgesForUsers([
    ...rows.map((row) => row.userId),
    ...(self ? [self.userId] : []),
  ])
  const serialized = rows.map((row, index) => serializeLeaderboardRow(row, index + 1, equippedBadgeMap.get(row.userId) || null))
  const selfVisible = self ? serialized.find((row) => row.userId === self.userId) : null
  return {
    mode: input.mode,
    period: periodType,
    periodKey: period.periodKey,
    rows: serialized,
    self: self && !selfVisible ? serializeLeaderboardRow(self, 0, equippedBadgeMap.get(self.userId) || null) : null,
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
