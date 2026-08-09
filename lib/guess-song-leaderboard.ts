import type { GuessSongMode, GuessSongPeriodType } from '@prisma/client'
import type { GuessSongPublicMode } from '@/lib/guess-song-config'
import { toPublicGuessSongMode } from '@/lib/guess-song-config'
import { compareGuessSongScores, getGuessSongPeriod, isGuessSongScoreBetter } from '@/lib/guess-song-period'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
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
      questionCount: true,
    },
  })
  if (!session || session.status !== 'COMPLETED' || !session.completedAt) return
  // Historical ten-question EASY sessions remain in history but must not enter
  // the replacement infinite simple leaderboard.
  if (session.mode === 'EASY' && session.questionCount !== null) return

  const leaderboardMode = toPublicGuessSongMode(session.mode) as GuessSongMode

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
        mode: leaderboardMode,
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
          mode: leaderboardMode,
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
    id: string
    uid: number
    nickname: string
    username: string
    avatarUrl: string | null
    Profile: { avatarUrl: string | null } | null
  }
}

function serializeRow(row: LeaderboardRow, rank: number, viewerId: string, remarkMap: ReadonlyMap<string, string>) {
  return {
    rank,
    userId: row.userId,
    uid: row.User.uid,
    nickname: resolveFriendDisplayName({
      viewerId,
      targetUserId: row.User.id,
      fallbackName: getPublicUserDisplayName(row.User),
      remarkMap,
    }),
    avatarUrl: row.User.Profile?.avatarUrl || row.User.avatarUrl,
    mode: row.mode ? toPublicGuessSongMode(row.mode) : undefined,
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
  mode: GuessSongPublicMode
  now?: Date
}) {
  const modeFilter: GuessSongMode[] = input.mode === 'EASY'
    ? ['EASY', 'ENDLESS']
    : [input.mode as GuessSongMode]
  const legacySimpleFilter = input.mode === 'EASY' ? { questionCount: null } : {}
  let periodKey: string
  let rows: LeaderboardRow[]

  if (input.periodType === 'YEAR') {
    const { start, end, periodKey: yearKey } = getGuessSongPeriod('YEAR', input.now)
    periodKey = yearKey
    const sessions = await prisma.guessSongSession.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: start, lt: end },
        mode: { in: modeFilter },
        ...legacySimpleFilter,
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
            id: true,
            uid: true,
            nickname: true,
            username: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
    })
    // 年榜：按当前模式统计，每个用户只取最高分的那一局（非累计求和）
    const best = new Map<string, LeaderboardRow>()
    for (const session of sessions) {
      const candidate: LeaderboardRow = {
        userId: session.userId,
        mode: toPublicGuessSongMode(session.mode) as GuessSongMode,
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
        mode: { in: modeFilter },
        ...(input.mode === 'EASY' ? { GuessSongSession: { questionCount: null } } : {}),
      },
      include: {
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            username: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
      take: 1000,
    })
    // 周榜/月榜：guessSongLeaderboardEntry 已存储该用户该模式该周期的最高单局成绩，直接采用（非累计）
    const bestByUser = new Map<string, LeaderboardRow>()
    for (const entry of entries) {
      const candidate = { ...entry, mode: toPublicGuessSongMode(entry.mode) as GuessSongMode }
      const current = bestByUser.get(candidate.userId)
      if (!current || compareGuessSongScores(candidate, current) < 0) bestByUser.set(candidate.userId, candidate)
    }
    rows = [...bestByUser.values()]
  }

  rows.sort(compareGuessSongScores)
  const remarkMap = await loadFriendRemarkMap(input.userId, rows.map((row) => row.userId))
  const ownIndex = rows.findIndex((row) => row.userId === input.userId)
  return {
    periodType: input.periodType,
    periodKey,
    mode: input.mode,
    algorithm: '同模式按分数、答对数、最高连击、较少播放次数和更早达成时间依次排序。',
    rows: rows.slice(0, 10).map((row, index) => serializeRow(row, index + 1, input.userId, remarkMap)),
    currentUser: ownIndex >= 0 ? serializeRow(rows[ownIndex], Math.max(1, ownIndex + 1), input.userId, remarkMap) : null,
  }
}

export async function getGuessSongRanks(userId: string, mode: GuessSongMode | GuessSongPublicMode, now = new Date()) {
  const publicMode = toPublicGuessSongMode(mode as GuessSongMode)
  const [week, month] = await Promise.all([
    getGuessSongLeaderboard({ userId, periodType: 'WEEK', mode: publicMode, now }),
    getGuessSongLeaderboard({ userId, periodType: 'MONTH', mode: publicMode, now }),
  ])
  return {
    weekRank: week.currentUser?.rank ?? null,
    monthRank: month.currentUser?.rank ?? null,
  }
}
