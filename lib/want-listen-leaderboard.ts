import { Prisma, type WantListenMode } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { publicModerationText, publicModerationUserName } from '@/lib/content-moderation'
import { prisma } from '@/lib/prisma'
import { compareWantListenScores, getWantListenPeriod, isWantListenScoreBetter, parseWantListenPeriod } from '@/lib/want-listen-period'

type Database = Prisma.TransactionClient | typeof prisma

type WantListenScore = {
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  completionTimeMs: number
  achievedAt: Date
}

export async function recordWantListenLeaderboard(sessionId: string, database: Database = prisma) {
  const session = await database.wantListenSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, mode: true, status: true, score: true, correctCount: true, maxStreak: true, totalQuestions: true, completionTimeMs: true, completedAt: true, antiCheatStatus: true },
  })
  if (!session || session.status !== 'COMPLETED' || !session.completedAt || session.completionTimeMs === null) return
  // 只有 antiCheatStatus = CLEAN 的成绩才进入排行榜（反作弊过滤）
  if (session.antiCheatStatus !== 'CLEAN') return

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
    const where = {
      userId_mode_periodType_periodKey: {
        userId: session.userId,
        mode: session.mode,
        periodType,
        periodKey: period.periodKey,
      },
    }
    const existing = await database.wantListenLeaderboardEntry.findUnique({ where })
    if (!existing) {
      await database.wantListenLeaderboardEntry.create({
        data: { userId: session.userId, sessionId: session.id, mode: session.mode, periodType, periodKey: period.periodKey, ...score },
      })
    } else if (isWantListenScoreBetter(score, existing)) {
      await database.wantListenLeaderboardEntry.update({ where, data: { sessionId: session.id, ...score } })
    }
  }
}

type LeaderboardUser = {
  id: string
  uid: number
  username: string
  nickname: string
  avatarUrl: string | null
  usernameModerationStatus: string
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
}, rank: number) {
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
      username: publicModerationUserName(row.User.username, [row.User.usernameModerationStatus]),
      nickname: safeName,
      displayName: publicModerationText(row.User.Profile?.displayName, row.User.Profile?.displayNameModerationStatus),
      avatarUrl: publicImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl),
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
    // 只有 antiCheatStatus = CLEAN 的场次才进入排行榜
    WantListenSession: { is: { antiCheatStatus: 'CLEAN' as const } },
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
          username: true,
          nickname: true,
          avatarUrl: true,
          usernameModerationStatus: true,
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
        WantListenSession: { is: { antiCheatStatus: 'CLEAN' as const } },
      },
      include: {
        User: {
          select: {
            id: true,
            uid: true,
            username: true,
            nickname: true,
            avatarUrl: true,
            usernameModerationStatus: true,
            nicknameModerationStatus: true,
            nicknameViolationDisplay: true,
            Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
          },
        },
      },
    })
    : null

  const serialized = rows.map((row, index) => serializeLeaderboardRow(row, index + 1))
  const selfVisible = self ? serialized.find((row) => row.userId === self.userId) : null
  return {
    mode: input.mode,
    period: periodType,
    periodKey: period.periodKey,
    rows: serialized,
    self: self && !selfVisible ? serializeLeaderboardRow(self, 0) : null,
  }
}

export { compareWantListenScores }
