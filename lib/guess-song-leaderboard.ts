import { Prisma, type GuessSongMode, type GuessSongPeriodType } from '@prisma/client'
import type { GuessSongPublicMode } from '@/lib/guess-song-config'
import { getGuessSongDatabaseModes, GUESS_SONG_SIMPLE_MODE, toPublicGuessSongMode } from '@/lib/guess-song-config'
import { compareGuessSongScores, getGuessSongPeriod, isGuessSongScoreBetter } from '@/lib/guess-song-period'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-risk'
import { prisma } from '@/lib/prisma'

type ScoreRecord = {
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: Date
}

export async function recordGuessSongLeaderboard(sessionId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
  const session = await db.guessSongSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      mode: true,
      status: true,
      isValid: true,
      riskScore: true,
      score: true,
      correctCount: true,
      maxStreak: true,
      totalPlayCount: true,
      completedAt: true,
      questionCount: true,
    },
  })
  if (!session || !['COMPLETED', 'EXPIRED'].includes(session.status) || !session.completedAt) return
  if (!session.isValid || session.riskScore >= GUESS_SONG_RISK_THRESHOLD) return
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
    const existing = await db.guessSongLeaderboardEntry.findUnique({ where })
    if (!existing) {
      await db.guessSongLeaderboardEntry.create({
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
      await db.guessSongLeaderboardEntry.update({
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
    Profile: { displayName: string | null; avatarUrl: string | null } | null
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

export async function getGuessSongPersonalBest(input: {
  userId: string
  mode: GuessSongPublicMode
}) {
  const session = await prisma.guessSongSession.findFirst({
    where: {
      userId: input.userId,
      mode: { in: getGuessSongDatabaseModes(input.mode) },
      status: { in: ['COMPLETED', 'EXPIRED'] },
      completedAt: { not: null },
      isValid: true,
      riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
      ...(input.mode === GUESS_SONG_SIMPLE_MODE ? { questionCount: null } : {}),
    },
    orderBy: [
      { score: 'desc' },
      { correctCount: 'desc' },
      { maxStreak: 'desc' },
      { totalPlayCount: 'asc' },
      { completedAt: 'asc' },
      { id: 'asc' },
    ],
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
  if (!session?.completedAt) return null

  const remarkMap = await loadFriendRemarkMap(input.userId, [session.User.id])
  return serializeRow({
    userId: session.userId,
    mode: session.mode,
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    totalPlayCount: session.totalPlayCount,
    achievedAt: session.completedAt,
    User: session.User,
  }, 1, input.userId, remarkMap)
}

type YearLeaderboardQueryRow = {
  session_id: string
  user_id: string
  mode: GuessSongMode
  score: number
  correct_count: number
  max_streak: number
  total_play_count: number
  completed_at: Date
  leaderboard_rank: number | bigint
  uid: number
  nickname: string
  username: string
  avatar_url: string | null
  profile_display_name: string | null
  profile_avatar_url: string | null
}

function toYearLeaderboardRow(row: YearLeaderboardQueryRow) {
  const leaderboardRow: LeaderboardRow = {
    userId: row.user_id,
    mode: toPublicGuessSongMode(row.mode) as GuessSongMode,
    score: row.score,
    correctCount: row.correct_count,
    maxStreak: row.max_streak,
    totalPlayCount: row.total_play_count,
    achievedAt: row.completed_at,
    User: {
      id: row.user_id,
      uid: row.uid,
      nickname: row.nickname,
      username: row.username,
      avatarUrl: row.avatar_url,
      Profile: row.profile_display_name === null && row.profile_avatar_url === null
        ? null
        : { displayName: row.profile_display_name, avatarUrl: row.profile_avatar_url },
    },
  }

  return {
    row: leaderboardRow,
    rank: Number(row.leaderboard_rank),
  }
}

async function getYearGuessSongLeaderboard(input: {
  userId: string
  mode: GuessSongPublicMode
  modeFilter: GuessSongMode[]
  periodKey: string
  start: Date
  end: Date
}) {
  const questionCountFilter = input.mode === GUESS_SONG_SIMPLE_MODE
    ? Prisma.sql`AND s.questionCount IS NULL`
    : Prisma.empty
  const selectedRows = await prisma.$queryRaw<YearLeaderboardQueryRow[]>(Prisma.sql`
    WITH eligible_sessions AS (
      SELECT
        s.id AS session_id,
        s.userId AS user_id,
        s.mode,
        s.score,
        s.correctCount AS correct_count,
        s.maxStreak AS max_streak,
        s.totalPlayCount AS total_play_count,
        s.completedAt AS completed_at,
        ROW_NUMBER() OVER (
          PARTITION BY s.userId
          ORDER BY
            s.score DESC,
            s.correctCount DESC,
            s.maxStreak DESC,
            s.totalPlayCount ASC,
            s.completedAt ASC,
            s.id ASC
        ) AS user_rank
      FROM \`GuessSongSession\` AS s
      WHERE s.status IN ('COMPLETED', 'EXPIRED')
        AND s.isValid = TRUE
        AND s.riskScore < ${GUESS_SONG_RISK_THRESHOLD}
        AND s.completedAt >= ${input.start}
        AND s.completedAt < ${input.end}
        AND s.mode IN (${Prisma.join(input.modeFilter)})
        ${questionCountFilter}
    ),
    best_sessions AS (
      SELECT
        session_id,
        user_id,
        mode,
        score,
        correct_count,
        max_streak,
        total_play_count,
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
        total_play_count,
        completed_at,
        ROW_NUMBER() OVER (
          ORDER BY
            score DESC,
            correct_count DESC,
            max_streak DESC,
            total_play_count ASC,
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
      ranked.total_play_count,
      ranked.completed_at,
      ranked.leaderboard_rank,
      u.uid,
      u.nickname,
      u.username,
      u.avatarUrl AS avatar_url,
      p.displayName AS profile_display_name,
      p.avatarUrl AS profile_avatar_url
    FROM ranked_sessions AS ranked
    INNER JOIN \`User\` AS u ON u.id = ranked.user_id
    LEFT JOIN \`Profile\` AS p ON p.userId = ranked.user_id
    WHERE ranked.leaderboard_rank <= 10 OR ranked.user_id = ${input.userId}
    ORDER BY ranked.leaderboard_rank ASC
    LIMIT 11
  `)

  const rankedRows = selectedRows.map(toYearLeaderboardRow)
  const topRows = rankedRows.filter((item) => item.rank <= 10)
  const ownRow = input.userId ? rankedRows.find((item) => item.row.userId === input.userId) || null : null
  const remarkTargets = [...topRows, ...(ownRow && ownRow.rank > 10 ? [ownRow] : [])]
  const remarkMap = await loadFriendRemarkMap(input.userId, remarkTargets.map((item) => item.row.userId))

  return {
    periodType: 'YEAR' as const,
    periodKey: input.periodKey,
    mode: input.mode,
    algorithm: '同模式按分数、答对数、最高连击、较少播放次数和更早达成时间依次排序。',
    rows: topRows.map((item) => serializeRow(item.row, item.rank, input.userId, remarkMap)),
    currentUser: ownRow ? serializeRow(ownRow.row, ownRow.rank, input.userId, remarkMap) : null,
  }
}

export async function getGuessSongLeaderboard(input: {
  userId: string
  periodType: GuessSongPeriodType | 'YEAR'
  mode: GuessSongPublicMode
  now?: Date
}) {
  const modeFilter: GuessSongMode[] = getGuessSongDatabaseModes(input.mode)

  if (input.periodType === 'YEAR') {
    const { start, end, periodKey: yearKey } = getGuessSongPeriod('YEAR', input.now)
    return getYearGuessSongLeaderboard({
      userId: input.userId,
      mode: input.mode,
      modeFilter,
      periodKey: yearKey,
      start,
      end,
    })
  }

  const periodKey = getGuessSongPeriod(input.periodType, input.now).periodKey
  const entries = await prisma.guessSongLeaderboardEntry.findMany({
    where: {
      periodType: input.periodType,
      periodKey,
      mode: { in: modeFilter },
      GuessSongSession: {
        isValid: true,
        riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
        ...(input.mode === GUESS_SONG_SIMPLE_MODE ? { questionCount: null } : {}),
      },
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
  const rows = [...bestByUser.values()]

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
