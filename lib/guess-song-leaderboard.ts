import { Prisma, type GuessSongMode, type GuessSongPeriodType } from '@prisma/client'
import type { GuessSongPublicMode } from '@/lib/guess-song-config'
import { getGuessSongDatabaseModes, GUESS_SONG_PUBLIC_MODES, GUESS_SONG_SIMPLE_MODE, isGuessSongMode, toPublicGuessSongMode } from '@/lib/guess-song-config'
import { getGuessSongPeriod, selectBestGuessSongRows } from '@/lib/guess-song-period'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-risk'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { getEquippedBadgesForUsers } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'
import {
  resolveGameRankingRange,
  type GameRankingRange,
} from '@/lib/game-ranking-range'

type GuessSongLeaderboardDatabase = Prisma.TransactionClient | typeof prisma
type GuessSongDeletionPeriodType = GuessSongPeriodType | 'YEAR'
type GuessSongDeletionFilter = {
  periodType?: GuessSongDeletionPeriodType
  periodKey?: string
  mode?: GuessSongPublicMode
}

type GuessSongAdminActionLog = { action: string; detail: unknown }

function canonicalGuessSongActionMode(value: unknown) {
  if (!isGuessSongMode(value)) return null
  return toPublicGuessSongMode(value)
}

function deletedSessionIdsFromDetail(detail: unknown) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return []
  const value = detail as Record<string, unknown>
  const ids = typeof value.sessionId === 'string' ? [value.sessionId] : []
  if (Array.isArray(value.sessionIds)) ids.push(...value.sessionIds.filter((id): id is string => typeof id === 'string'))
  return ids
}

export function collectGuessSongDeletedSessionIds(
  logs: readonly GuessSongAdminActionLog[],
  filter: GuessSongDeletionFilter = {},
) {
  const deleted = new Set<string>()
  for (const log of logs) {
    if (log.action !== 'GUESS_SONG_DELETE_SCORE') continue
    const detail = log.detail as Record<string, unknown>
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) continue
    if (filter.periodType && detail.periodType !== filter.periodType) continue
    if (filter.periodKey && detail.periodKey !== filter.periodKey) continue
    const loggedMode = canonicalGuessSongActionMode(detail.mode)
    // Existing delete logs carry the public mode. If an older log has no
    // parseable mode, conservatively keep its exclusion for the requested mode.
    if (filter.mode && loggedMode && loggedMode !== filter.mode) continue
    for (const sessionId of deletedSessionIdsFromDetail(detail)) deleted.add(sessionId)
  }
  return deleted
}

export async function getGuessSongDeletedSessionIds(
  filter: GuessSongDeletionFilter = {},
  database: GuessSongLeaderboardDatabase = prisma,
) {
  const logs = await database.adminActionLog.findMany({
    where: { action: 'GUESS_SONG_DELETE_SCORE' },
    select: { action: true, detail: true },
  })
  return collectGuessSongDeletedSessionIds(logs, filter)
}

export async function getGuessSongDeletedYearSessionIds(
  periodKey?: string,
  database: GuessSongLeaderboardDatabase = prisma,
) {
  return getGuessSongDeletedSessionIds({ periodType: 'YEAR', periodKey }, database)
}

type ScoreRecord = {
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: Date
}

type GuessSongLeaderboardKey = {
  userId: string
  mode: GuessSongMode
  periodType: GuessSongPeriodType
  periodKey: string
}

function guessSongBetterThanCandidateWhere(
  key: GuessSongLeaderboardKey,
  candidate: ScoreRecord,
): Prisma.GuessSongLeaderboardEntryWhereInput {
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
        totalPlayCount: { gt: candidate.totalPlayCount },
      },
      {
        score: candidate.score,
        correctCount: candidate.correctCount,
        maxStreak: candidate.maxStreak,
        totalPlayCount: candidate.totalPlayCount,
        achievedAt: { gt: candidate.achievedAt },
      },
    ],
  }
}

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function writeGuessSongLeaderboardEntry(
  database: GuessSongLeaderboardDatabase,
  key: GuessSongLeaderboardKey,
  sessionId: string,
  score: ScoreRecord,
) {
  const betterThanCandidateWhere = guessSongBetterThanCandidateWhere(key, score)
  const updateData = { sessionId, ...score }
  const updated = await database.guessSongLeaderboardEntry.updateMany({
    where: betterThanCandidateWhere,
    data: updateData,
  })
  if (updated.count > 0) return

  try {
    await database.guessSongLeaderboardEntry.create({
      data: { ...key, sessionId, ...score },
    })
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) throw error
    // Another request won the first insert. Re-evaluate the same atomic
    // condition against its committed row so a lower score cannot replace it.
    await database.guessSongLeaderboardEntry.updateMany({
      where: betterThanCandidateWhere,
      data: updateData,
    })
  }
}

export type GuessSongModeHighScore = {
  mode: GuessSongPublicMode
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: string
  userId: string
  uid: number
  displayName: string | null
  nickname: string
  avatarUrl: string | null
  user: {
    id: string
    uid: number
    displayName: string | null
    nickname: string
    name: string
    avatarUrl: string | null
    equippedBadges?: EquippedBadgeView[]
    /** @deprecated use equippedBadges */
    equippedBadge?: EquippedBadgeView | null
  }
}

export type GuessSongModeHighScores = {
  status: 'ready' | 'empty' | 'unavailable'
  periodType: 'HISTORY'
  periodKey: 'ALL'
  modes: Record<GuessSongPublicMode, GuessSongModeHighScore | null>
  mobileBest: GuessSongModeHighScore | null
}

function emptyGuessSongModeHighScores(status: GuessSongModeHighScores['status']): GuessSongModeHighScores {
  return {
    status,
    periodType: 'HISTORY',
    periodKey: 'ALL',
    modes: Object.fromEntries(GUESS_SONG_PUBLIC_MODES.map((mode) => [mode, null])) as GuessSongModeHighScores['modes'],
    mobileBest: null,
  }
}

/**
 * Builds the complete four-mode result from already-ranked records.
 * GUESS_SONG_PUBLIC_MODES supplies the stable mode order used for mobile ties.
 */
export function buildGuessSongModeHighScores(rows: readonly GuessSongModeHighScore[]): GuessSongModeHighScores {
  const modes = emptyGuessSongModeHighScores('empty').modes
  for (const row of rows) {
    if (modes[row.mode] === null) modes[row.mode] = row
  }

  const available = GUESS_SONG_PUBLIC_MODES
    .map((mode) => modes[mode])
    .filter((row): row is GuessSongModeHighScore => row !== null)
  const mobileBest = available.reduce<GuessSongModeHighScore | null>((best, row) => {
    // Strictly greater keeps the existing mode order when scores tie.
    return !best || row.score > best.score ? row : best
  }, null)

  return {
    status: mobileBest ? 'ready' : 'empty',
    periodType: 'HISTORY',
    periodKey: 'ALL',
    modes,
    mobileBest,
  }
}

function serializeModeHighScore(
  row: {
    userId: string
    mode: GuessSongMode
    score: number
    correctCount: number
    maxStreak: number
    totalPlayCount: number
    completedAt: Date | null
    User: {
      id: string
      uid: number
      nickname: string
      nicknameModerationStatus?: string | null
      avatarUrl: string | null
      Profile: { displayName: string | null; displayNameModerationStatus?: string | null; avatarUrl: string | null } | null
    }
  },
  publicMode: GuessSongPublicMode,
  equippedBadges: readonly EquippedBadgeView[],
): GuessSongModeHighScore | null {
  if (!row.completedAt) return null
  const safeName = getPublicUserDisplayName(row.User)
  const avatarUrl = publicImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl)
  return {
    mode: publicMode,
    score: row.score,
    correctCount: row.correctCount,
    maxStreak: row.maxStreak,
    totalPlayCount: row.totalPlayCount,
    achievedAt: row.completedAt.toISOString(),
    userId: row.User.id,
    uid: row.User.uid,
    displayName: safeName,
    nickname: safeName,
    avatarUrl,
    user: {
      id: row.User.id,
      uid: row.User.uid,
      displayName: safeName,
      nickname: safeName,
      name: safeName,
      avatarUrl,
      equippedBadges: [...equippedBadges],
      equippedBadge: equippedBadges[0] || null,
    },
  }
}

/**
 * Returns the all-time top record for each public mode, including the user
 * relation from that exact record. The ordering mirrors the formal historical
 * leaderboard ordering and the query is deliberately uncached so fresh scores
 * and profile changes appear on the next homepage refresh.
 */
export async function getGuessSongModeHighScores(): Promise<GuessSongModeHighScores> {
  try {
    const deletedSessionIds = await getGuessSongDeletedYearSessionIds()
    const deletedSessionFilter = deletedSessionIds.size > 0
      ? { id: { notIn: [...deletedSessionIds] } }
      : {}
    const rows = await Promise.all(GUESS_SONG_PUBLIC_MODES.map(async (publicMode) => {
      const row = await prisma.guessSongSession.findFirst({
        where: {
          ...deletedSessionFilter,
          mode: { in: getGuessSongDatabaseModes(publicMode) },
          status: { in: ['COMPLETED', 'EXPIRED'] },
          completedAt: { not: null },
          isValid: true,
          riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
          ...(publicMode === GUESS_SONG_SIMPLE_MODE ? { questionCount: null } : {}),
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
              nicknameModerationStatus: true,
              nicknameViolationDisplay: true,
              avatarUrl: true,
              Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
            },
          },
        },
      })
      return row ? { publicMode, row } : null
    }))

    const availableRows = rows.filter((item): item is NonNullable<typeof item> => item !== null && item.row.completedAt !== null)
    const equippedBadgesMap = await getEquippedBadgesForUsers(availableRows.map(({ row }) => row.User.id))
    const serializedRows = availableRows
      .map(({ publicMode, row }) => serializeModeHighScore(row, publicMode, equippedBadgesMap.get(row.User.id) || []))
      .filter((row): row is GuessSongModeHighScore => row !== null)
    return buildGuessSongModeHighScores(serializedRows)
  } catch (error) {
    console.error('[guess-song.home-mode-high-scores]', error)
    return emptyGuessSongModeHighScores('unavailable')
  }
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

  const leaderboardMode = toPublicGuessSongMode(session.mode)

  const score: ScoreRecord = {
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    totalPlayCount: session.totalPlayCount,
    achievedAt: session.completedAt,
  }

  for (const periodType of ['WEEK', 'MONTH'] as const) {
    const { periodKey } = getGuessSongPeriod(periodType, session.completedAt)
    const deletedSessionIds = await getGuessSongDeletedSessionIds(
      { mode: leaderboardMode, periodType, periodKey },
      db,
    )
    if (deletedSessionIds.has(session.id)) continue
    await writeGuessSongLeaderboardEntry(
      db,
      {
        userId: session.userId,
        mode: leaderboardMode,
        periodType,
        periodKey,
      },
      session.id,
      score,
    )
  }
}

type LeaderboardRow = ScoreRecord & {
  userId: string
  mode?: GuessSongMode
  User: {
    id: string
    uid: number
    nickname: string
    nicknameModerationStatus?: string | null
    avatarUrl: string | null
    Profile: { displayName: string | null; displayNameModerationStatus?: string | null; avatarUrl: string | null } | null
  }
}

function serializeRow(row: LeaderboardRow, rank: number, equippedBadges: readonly EquippedBadgeView[] = []) {
  return {
    rank,
    userId: row.userId,
    uid: row.User.uid,
    nickname: getPublicUserDisplayName(row.User),
    avatarUrl: publicImageUrl(row.User.Profile?.avatarUrl || row.User.avatarUrl),
    equippedBadges: [...equippedBadges],
    equippedBadge: equippedBadges[0] || null,
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
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
    },
  })
  if (!session?.completedAt) return null

  const equippedBadgesMap = await getEquippedBadgesForUsers([session.User.id])
  return serializeRow({
    userId: session.userId,
    mode: session.mode,
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    totalPlayCount: session.totalPlayCount,
    achievedAt: session.completedAt,
    User: session.User,
  }, 1, equippedBadgesMap.get(session.User.id) || [])
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
  nicknameModerationStatus: string | null
  avatar_url: string | null
  profile_display_name: string | null
  profile_display_name_moderation_status: string | null
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
      nicknameModerationStatus: row.nicknameModerationStatus,
      avatarUrl: row.avatar_url,
      Profile: row.profile_display_name === null && row.profile_avatar_url === null
        ? null
        : { displayName: row.profile_display_name, displayNameModerationStatus: row.profile_display_name_moderation_status, avatarUrl: row.profile_avatar_url },
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
  excludedSessionIds: ReadonlySet<string>
  periodType: GuessSongPeriodType | 'YEAR' | 'DATE'
  range: GameRankingRange | null
}) {
  const questionCountFilter = input.mode === GUESS_SONG_SIMPLE_MODE
    ? Prisma.sql`AND s.questionCount IS NULL`
    : Prisma.empty
  const deletedSessionFilter = input.excludedSessionIds.size > 0
    ? Prisma.sql`AND s.id NOT IN (${Prisma.join([...input.excludedSessionIds])})`
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
        ${deletedSessionFilter}
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
      u.nicknameModerationStatus,
      u.avatarUrl AS avatar_url,
      p.displayName AS profile_display_name,
      p.displayNameModerationStatus AS profile_display_name_moderation_status,
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
  const badgeTargets = [...topRows, ...(ownRow && ownRow.rank > 10 ? [ownRow] : [])]
  const equippedBadgesMap = await getEquippedBadgesForUsers(badgeTargets.map((item) => item.row.userId))

  return {
    periodType: input.periodType,
    periodKey: input.periodKey,
    rangeKey: input.range?.key || null,
    rangeDate: input.range?.date || null,
    rangeLabel: input.range?.label || (input.periodType === 'YEAR' ? '年度' : null),
    cacheKey: input.range
      ? `guess-song:${input.mode}:${input.range.cacheKey}`
      : `guess-song:${input.mode}:${input.periodType}:${input.periodKey}`,
    mode: input.mode,
    algorithm: '同模式按分数、答对数、最高连击、较少播放次数和更早达成时间依次排序。',
    rows: topRows.map((item) => serializeRow(item.row, item.rank, equippedBadgesMap.get(item.row.userId) || [])),
    currentUser: ownRow ? serializeRow(ownRow.row, ownRow.rank, equippedBadgesMap.get(ownRow.row.userId) || []) : null,
  }
}

export async function getGuessSongLeaderboard(input: {
  userId: string
  periodType?: GuessSongPeriodType | 'YEAR'
  mode: GuessSongPublicMode
  range?: unknown
  date?: unknown
  resolvedRange?: GameRankingRange
  now?: Date
}) {
  const now = input.now || new Date()
  const modeFilter: GuessSongMode[] = getGuessSongDatabaseModes(input.mode)
  const hasUnifiedRange = input.range !== undefined && input.range !== null && input.range !== ''

  if (hasUnifiedRange) {
    const range = input.resolvedRange || resolveGameRankingRange({ range: input.range, date: input.date, now })
    if (range.key === 'date') {
      const excludedSessionIds = await getGuessSongDeletedSessionIds({ mode: input.mode })
      return getYearGuessSongLeaderboard({
        userId: input.userId,
        mode: input.mode,
        modeFilter,
        periodKey: range.periodKey,
        start: range.startAt,
        end: range.endAt,
        excludedSessionIds,
        periodType: 'DATE',
        range,
      })
    }

    const periodType: GuessSongPeriodType = range.key === 'this-month' || range.key === 'last-month' ? 'MONTH' : 'WEEK'
    return getGuessSongLeaderboard({
      userId: input.userId,
      periodType,
      mode: input.mode,
      now,
      resolvedRange: range,
    })
  }

  const periodType = input.periodType || 'WEEK'
  if (periodType === 'YEAR') {
    const { start, end, periodKey: yearKey } = getGuessSongPeriod('YEAR', now)
    const excludedSessionIds = await getGuessSongDeletedYearSessionIds(yearKey)
    return getYearGuessSongLeaderboard({
      userId: input.userId,
      mode: input.mode,
      modeFilter,
      periodKey: yearKey,
      start,
      end,
      excludedSessionIds,
      periodType: 'YEAR',
      range: null,
    })
  }

  const range = input.resolvedRange || resolveGameRankingRange({
    range: periodType === 'MONTH' ? 'this-month' : 'this-week',
    now,
  })
  const periodKey = range.periodKey
  const deletedSessionIds = await getGuessSongDeletedSessionIds({
    mode: input.mode,
    periodType,
    periodKey,
  })
  const entries = await prisma.guessSongLeaderboardEntry.findMany({
    where: {
      periodType,
      periodKey,
      mode: { in: modeFilter },
      ...(deletedSessionIds.size > 0 ? { sessionId: { notIn: [...deletedSessionIds] } } : {}),
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
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
    },
  })
    // 周榜/月榜：先读取完整候选集，再在应用层跨 EASY/ENDLESS 选每位用户的最好成绩。
    // 不能在这里 take，否则重复用户会消耗名额，导致 Top 10 漏人。
    // guessSongLeaderboardEntry 已存储该用户该模式该周期的最高单局成绩，直接采用（非累计）
  const rows = selectBestGuessSongRows(entries)
  const equippedBadgesMap = await getEquippedBadgesForUsers(rows.map((row) => row.userId))
  const ownIndex = rows.findIndex((row) => row.userId === input.userId)
  return {
    periodType,
    periodKey,
    rangeKey: range.key,
    rangeDate: range.date,
    rangeLabel: range.label,
    cacheKey: `guess-song:${input.mode}:${range.cacheKey}`,
    mode: input.mode,
    algorithm: '同模式按分数、答对数、最高连击、较少播放次数和更早达成时间依次排序。',
    rows: rows.slice(0, 10).map((row, index) => serializeRow(row, index + 1, equippedBadgesMap.get(row.userId) || [])),
    currentUser: ownIndex >= 0 ? serializeRow(rows[ownIndex], Math.max(1, ownIndex + 1), equippedBadgesMap.get(rows[ownIndex].userId) || []) : null,
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
