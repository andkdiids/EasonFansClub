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
  user: {
    uid: number
    nickname: string
    username: string
    avatarUrl: string | null
    profile: { avatarUrl: string | null } | null
  }
}

function serializeRow(row: LeaderboardRow, rank: number) {
  return {
    rank,
    userId: row.userId,
    uid: row.user.uid,
    nickname: row.user.nickname || row.user.username,
    avatarUrl: row.user.profile?.avatarUrl || row.user.avatarUrl,
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
  periodType: GuessSongPeriodType
  mode: GuessSongMode | 'ALL'
  now?: Date
}) {
  const { periodKey } = getGuessSongPeriod(input.periodType, input.now)
  const entries = await prisma.guessSongLeaderboardEntry.findMany({
    where: {
      periodType: input.periodType,
      periodKey,
      ...(input.mode === 'ALL' ? {} : { mode: input.mode }),
    },
    include: {
      user: {
        select: {
          uid: true,
          nickname: true,
          username: true,
          avatarUrl: true,
          profile: { select: { avatarUrl: true } },
        },
      },
    },
    take: 1000,
  })

  let rows: LeaderboardRow[]
  if (input.mode === 'ALL') {
    const grouped = new Map<string, LeaderboardRow>()
    for (const entry of entries) {
      const current = grouped.get(entry.userId)
      if (!current) {
        grouped.set(entry.userId, {
          userId: entry.userId,
          user: entry.user,
          score: entry.score,
          correctCount: entry.correctCount,
          maxStreak: entry.maxStreak,
          totalPlayCount: entry.totalPlayCount,
          achievedAt: entry.achievedAt,
        })
      } else {
        current.score += entry.score
        current.correctCount += entry.correctCount
        current.maxStreak = Math.max(current.maxStreak, entry.maxStreak)
        current.totalPlayCount += entry.totalPlayCount
        if (entry.achievedAt < current.achievedAt) current.achievedAt = entry.achievedAt
      }
    }
    rows = [...grouped.values()]
  } else {
    rows = entries.map((entry) => ({ ...entry, mode: entry.mode }))
  }

  rows.sort(compareGuessSongScores)
  const ownIndex = rows.findIndex((row) => row.userId === input.userId)
  return {
    periodType: input.periodType,
    periodKey,
    mode: input.mode,
    algorithm: input.mode === 'ALL'
      ? '综合榜为用户四种模式当期最高有效分之和；并列时依次比较答对数、最高连击、总播放次数和更早达成时间。'
      : '同模式按分数、答对数、最高连击、较少播放次数和更早达成时间依次排序。',
    rows: rows.slice(0, 50).map(serializeRow),
    currentUser: ownIndex >= 0 ? serializeRow(rows[ownIndex], ownIndex + 1) : null,
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
