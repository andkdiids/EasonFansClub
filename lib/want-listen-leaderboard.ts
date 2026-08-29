import { Prisma, type WantListenMode } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { compareWantListenScores, getWantListenPeriod, parseWantListenPeriod } from '@/lib/want-listen-period'
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
  Profile: { displayName: string | null; displayNameModerationStatus: string; avatarUrl: string | null } | null
}

function serializeLeaderboardRow(row: {
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
}, rank: number, equippedBadge?: EquippedBadgeView | null) {
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

export async function getWantListenLeaderboard(input: {
  mode: WantListenMode
  period?: unknown
  userId?: string
  limit?: number
}) {
  const periodType = parseWantListenPeriod(input.period)
  const period = getWantListenPeriod(periodType)
  const limit = Math.max(1, Math.min(100, input.limit || 50))
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
