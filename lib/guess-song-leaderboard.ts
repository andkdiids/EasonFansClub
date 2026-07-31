import type { GuessSongMode, GuessSongPeriodType } from '@prisma/client'
import { compareGuessSongScores, getGuessSongPeriod, isGuessSongScoreBetter } from '@/lib/guess-song-period'
import { prisma } from '@/lib/prisma'

type ScoreRecord = {
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: Date
}

export async function recordGuessSongLeaderboard(sessionId: string) {
  const session = await prisma.guessSongSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      mode: true,
      status: true,
      score: true,
      correctCount: true,
      maxStreak: true,
      totalPlayCount: true,
      completedAt: true,
    },
  })
  if (!session || session.status !== 'COMPLETED' || !session.completedAt) return

  const score: ScoreRecord = {
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    totalPlayCount: session.totalPlayCount,
    achievedAt: session.completedAt,
  }

  for (const periodType of ['WEEK', 'MONTH'] as const) {
    const { periodKey } = getGuessSongPeriod(periodType, session.completedAt)
    const where = {
      userId_mode_periodType_periodKey: {
        userId: session.userId,
        mode: session.mode,
        periodType,
        periodKey,
      },
    }
    const existing = await prisma.guessSongLeaderboardEntry.findUnique({ where })
    if (!existing) {
      await prisma.guessSongLeaderboardEntry.create({
        data: {
          userId: session.userId,
          sessionId: session.id,
          mode: session.mode,
          periodType,
          periodKey,
          ...score,
        },
      })
    } else if (isGuessSongScoreBetter(score, existing)) {
      await prisma.guessSongLeaderboardEntry.update({
        where,
        data: { sessionId: session.id, ...score },
      })
    }
  }
}

type LeaderboardRow = ScoreRecord & {
  userId: string
  mode?: GuessSongMode
  User: {
    uid: number
    nickname: string
    username: string
    avatarUrl: string | null
    Profile: { avatarUrl: string | null } | null
  }
}

function serializeRow(row: LeaderboardRow, rank: number) {
  return {
    rank,
    userId: row.userId,
    uid: row.User.uid,
    nickname: row.User.nickname || row.User.username,
    avatarUrl: row.User.Profile?.avatarUrl || row.User.avatarUrl,
    mode: row.mode,
    score: row.score,
    correctCount: row.correctCount,
    maxStreak: row.maxStreak,
    totalPlayCount: row.totalPlayCount,
    achievedAt: row.achievedAt.toISOString(),
  }
}

export async function getGuessSongLeaderboard(input: {
  userId: string
  periodType: GuessSongPeriodType | 'YEAR'
  mode: GuessSongMode
  now?: Date
}) {
  let periodKey: string
  let rows: LeaderboardRow[]

  if (input.periodType === 'YEAR') {
    const { start, end, periodKey: yearKey } = getGuessSongPeriod('YEAR', input.now)
    periodKey = yearKey
    const sessions = await prisma.guessSongSession.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: start, lt: end },
        mode: input.mode,
      },
      select: {
        userId: true,
        mode: true,
        score: true,
        correctCount: true,
        maxStreak: true,
        totalPlayCount: true,
        completedAt: true,
        User: {
          select: {
            uid: true,
            nickname: true,
            username: true,
            avatarUrl: true,
            Profile: { select: { avatarUrl: true } },
          },
        },
      },
    })
    // 年榜：按当前模式统计，每个用户只取最高分的那一局（非累计求和）
    const best = new Map<string, LeaderboardRow>()
    for (const session of sessions) {
      const candidate: LeaderboardRow = {
        userId: session.userId,
        mode: session.mode,
        User: session.User,
        score: session.score,
        correctCount: session.correctCount,
        maxStreak: session.maxStreak,
        totalPlayCount: session.totalPlayCount,
        achievedAt: session.completedAt!,
      }
      const current = best.get(session.userId)
      if (!current || compareGuessSongScores(candidate, current) < 0) {
        best.set(session.userId, candidate)
      }
    }
    rows = [...best.values()]
  } else {
    const resolved = getGuessSongPeriod(input.periodType, input.now)
    periodKey = resolved.periodKey
    const entries = await prisma.guessSongLeaderboardEntry.findMany({
      where: {
        periodType: input.periodType,
        periodKey,
        mode: input.mode,
      },
      include: {
        User: {
          select: {
            uid: true,
            nickname: true,
            username: true,
            avatarUrl: true,
            Profile: { select: { avatarUrl: true } },
          },
        },
      },
      take: 1000,
    })
    // 周榜/月榜：guessSongLeaderboardEntry 已存储该用户该模式该周期的最高单局成绩，直接采用（非累计）
    rows = entries.map((entry) => ({ ...entry, mode: entry.mode }))
  }

  rows.sort(compareGuessSongScores)
  const ownIndex = rows.findIndex((row) => row.userId === input.userId)
  return {
    periodType: input.periodType,
    periodKey,
    mode: input.mode,
    algorithm: '同模式按分数、答对数、最高连击、较少播放次数和更早达成时间依次排序。',
    rows: rows.slice(0, 10).map((row, index) => serializeRow(row, index + 1)),
    currentUser: ownIndex >= 0 ? serializeRow(rows[ownIndex], Math.max(1, ownIndex + 1)) : null,
  }
}

export async function getGuessSongRanks(userId: string, mode: GuessSongMode, now = new Date()) {
  const [week, month] = await Promise.all([
    getGuessSongLeaderboard({ userId, periodType: 'WEEK', mode, now }),
    getGuessSongLeaderboard({ userId, periodType: 'MONTH', mode, now }),
  ])
  return {
    weekRank: week.currentUser?.rank ?? null,
    monthRank: month.currentUser?.rank ?? null,
  }
}
