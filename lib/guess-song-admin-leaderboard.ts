import type { GuessSongMode, GuessSongPeriodType } from '@prisma/client'
import {
  GUESS_SONG_BASE_SCORE,
  getGuessSongDatabaseModes,
  isGuessSongPublicMode,
  type GuessSongPublicMode,
  toPublicGuessSongMode,
  calculateGuessSongScore,
} from '@/lib/guess-song-config'
import { compareGuessSongScores, getGuessSongPeriod } from '@/lib/guess-song-period'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-risk'
import { prisma } from '@/lib/prisma'

export const GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS = 20
export const GUESS_SONG_ADMIN_MAX_STARTING_STREAK = 1000

export class GuessSongAdminLeaderboardError extends Error {
  constructor(readonly message: string, readonly status = 400, readonly code = 'ADMIN_LEADERBOARD_ERROR') {
    super(message)
    this.name = 'GuessSongAdminLeaderboardError'
  }
}

function assertPublicMode(value: unknown): asserts value is GuessSongPublicMode {
  if (!isGuessSongPublicMode(value)) throw new GuessSongAdminLeaderboardError('请选择有效听听模式')
}

function assertPeriodType(value: unknown): asserts value is GuessSongPeriodType {
  if (value !== 'WEEK' && value !== 'MONTH') throw new GuessSongAdminLeaderboardError('请选择有效榜单周期')
}

function assertPositiveInteger(value: unknown, label: string, max: number) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > max) {
    throw new GuessSongAdminLeaderboardError(`${label}必须是 1-${max} 的整数`)
  }
  return Number(value)
}

function assertNonNegativeInteger(value: unknown, label: string, max: number) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw new GuessSongAdminLeaderboardError(`${label}必须是 0-${max} 的整数`)
  }
  return Number(value)
}

export function calculateGuessSongAdminCompensation(input: {
  mode: GuessSongMode
  correctAnswers: number
  startingStreak: number
}) {
  const correctAnswers = assertPositiveInteger(input.correctAnswers, '补回答对题数', GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS)
  const startingStreak = assertNonNegativeInteger(input.startingStreak, '补分前连击', GUESS_SONG_ADMIN_MAX_STARTING_STREAK)
  let totalScore = 0
  for (let index = 1; index <= correctAnswers; index += 1) {
    totalScore += calculateGuessSongScore({
      mode: input.mode,
      playCount: 1,
      streak: startingStreak + index,
      durationSeconds: 0,
      correct: true,
    })
  }
  return {
    correctAnswers,
    startingStreak,
    baseScore: correctAnswers * GUESS_SONG_BASE_SCORE,
    comboBonus: totalScore - correctAnswers * GUESS_SONG_BASE_SCORE,
    totalScore,
  }
}

function getPeriodBounds(periodType: GuessSongPeriodType, periodKey: string | null | undefined) {
  const current = getGuessSongPeriod(periodType)
  if (!periodKey) return current
  const validFormat = periodType === 'WEEK' ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}$/
  if (!validFormat.test(periodKey)) throw new GuessSongAdminLeaderboardError('榜单周期标识无效')
  const reference = periodType === 'WEEK'
    ? new Date(`${periodKey}T12:00:00+08:00`)
    : new Date(`${periodKey}-15T12:00:00+08:00`)
  const selected = getGuessSongPeriod(periodType, reference)
  if (selected.periodKey !== periodKey) throw new GuessSongAdminLeaderboardError('榜单周期标识无效')
  return selected
}

function userSearchFilter(query: string) {
  const normalized = query.trim().slice(0, 80)
  if (!normalized) return undefined
  const uid = /^\d+$/.test(normalized) ? Number(normalized) : null
  return {
    OR: [
      { nickname: { contains: normalized } },
      { username: { contains: normalized } },
      ...(uid !== null ? [{ uid }] : []),
    ],
  }
}

type AdminEntry = {
  id: string
  userId: string
  mode: GuessSongMode
  periodType: GuessSongPeriodType
  periodKey: string
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  achievedAt: Date
  sessionId: string
  User: {
    id: string
    uid: number
    nickname: string
    username: string
    avatarUrl: string | null
    Profile: { displayName: string | null; avatarUrl: string | null } | null
  }
  GuessSongSession: { status: string; completedAt: Date | null }
}

function serializeEntry(entry: AdminEntry, entryIds: string[]) {
  return {
    id: entry.id,
    entryIds,
    userId: entry.userId,
    uid: entry.User.uid,
    nickname: entry.User.nickname,
    username: entry.User.username,
    displayName: entry.User.Profile?.displayName || entry.User.nickname,
    avatarUrl: entry.User.Profile?.avatarUrl || entry.User.avatarUrl,
    mode: toPublicGuessSongMode(entry.mode),
    databaseMode: entry.mode,
    periodType: entry.periodType,
    periodKey: entry.periodKey,
    score: entry.score,
    correctCount: entry.correctCount,
    maxStreak: entry.maxStreak,
    totalPlayCount: entry.totalPlayCount,
    achievedAt: entry.achievedAt.toISOString(),
    sessionId: entry.sessionId,
    sessionStatus: entry.GuessSongSession.status,
  }
}

export async function listGuessSongAdminLeaderboard(input: {
  mode: unknown
  periodType: unknown
  periodKey?: string | null
  query?: string
}) {
  assertPublicMode(input.mode)
  assertPeriodType(input.periodType)
  const period = getPeriodBounds(input.periodType, input.periodKey)
  const modeValues = getGuessSongDatabaseModes(input.mode)
  const rows = await prisma.guessSongLeaderboardEntry.findMany({
    where: {
      mode: { in: modeValues },
      periodType: input.periodType,
      periodKey: period.periodKey,
      User: userSearchFilter(input.query || ''),
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
      GuessSongSession: { select: { status: true, completedAt: true } },
    },
    orderBy: [{ score: 'desc' }, { achievedAt: 'asc' }],
    take: 500,
  })

  const bestByUser = new Map<string, { best: AdminEntry; entryIds: string[] }>()
  for (const row of rows as AdminEntry[]) {
    const current = bestByUser.get(row.userId)
    if (!current) {
      bestByUser.set(row.userId, { best: row, entryIds: [row.id] })
      continue
    }
    current.entryIds.push(row.id)
    if (compareGuessSongScores(row, current.best) < 0) current.best = row
  }

  return {
    mode: input.mode,
    periodType: input.periodType,
    periodKey: period.periodKey,
    rows: [...bestByUser.values()]
      .sort((left, right) => compareGuessSongScores(left.best, right.best))
      .map(({ best, entryIds }) => serializeEntry(best, entryIds)),
  }
}

function sessionPeriodFilter(period: { start: Date; end: Date }) {
  return {
    OR: [
      { completedAt: { gte: period.start, lt: period.end } },
      { completedAt: null, createdAt: { gte: period.start, lt: period.end } },
    ],
  }
}

export async function deleteGuessSongAdminLeaderboard(input: {
  adminId: string
  userId: string
  mode: unknown
  periodType: unknown
  periodKey?: string | null
  reason: unknown
}) {
  const mode = input.mode
  const periodType = input.periodType
  assertPublicMode(mode)
  assertPeriodType(periodType)
  const reason = String(input.reason || '').trim().slice(0, 200)
  if (reason.length < 2) throw new GuessSongAdminLeaderboardError('删除原因不能为空')
  const period = getPeriodBounds(periodType, input.periodKey)
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!target) throw new GuessSongAdminLeaderboardError('用户不存在', 404, 'USER_NOT_FOUND')
    const entries = await tx.guessSongLeaderboardEntry.findMany({
      where: { userId: input.userId, mode: { in: getGuessSongDatabaseModes(mode) }, periodType, periodKey: period.periodKey },
      select: { id: true, score: true, mode: true },
    })
    if (!entries.length) throw new GuessSongAdminLeaderboardError('该用户没有对应榜单成绩', 404, 'SCORE_NOT_FOUND')
    const beforeScore = Math.max(...entries.map((entry) => entry.score))
    await tx.guessSongLeaderboardEntry.deleteMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
    })
    await tx.adminActionLog.create({
      data: {
        adminId: input.adminId,
        targetUserId: input.userId,
        action: 'GUESS_SONG_DELETE_SCORE',
        detail: {
          mode,
          periodType,
          periodKey: period.periodKey,
          beforeScore,
          deletedEntryIds: entries.map((entry) => entry.id),
          reason,
        },
      },
    })
    return { deletedCount: entries.length, mode, periodType, periodKey: period.periodKey }
  })
}

export async function addGuessSongAdminScore(input: {
  adminId: string
  userId: string
  mode: unknown
  periodType: unknown
  periodKey?: string | null
  correctAnswers: unknown
  startingStreak: unknown
  reason: unknown
}) {
  const mode = input.mode
  const periodType = input.periodType
  assertPublicMode(mode)
  assertPeriodType(periodType)
  const period = getPeriodBounds(periodType, input.periodKey)
  const reason = String(input.reason || '').trim().slice(0, 200)
  if (reason.length < 2) throw new GuessSongAdminLeaderboardError('补分原因不能为空')
  const correctAnswers = assertPositiveInteger(input.correctAnswers, '补回答对题数', GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS)
  const startingStreak = assertNonNegativeInteger(input.startingStreak, '补分前连击', GUESS_SONG_ADMIN_MAX_STARTING_STREAK)

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!target) throw new GuessSongAdminLeaderboardError('用户不存在', 404, 'USER_NOT_FOUND')
    const modeValues = getGuessSongDatabaseModes(mode)
    const entries = await tx.guessSongLeaderboardEntry.findMany({
      where: { userId: input.userId, mode: { in: modeValues }, periodType, periodKey: period.periodKey },
      include: { GuessSongSession: { select: { status: true, mode: true } } },
      orderBy: [{ score: 'desc' }, { achievedAt: 'asc' }],
    })
    const candidate = entries[0]
      ? null
      : await tx.guessSongSession.findFirst({
        where: {
          userId: input.userId,
          mode: { in: modeValues },
          isValid: true,
          riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
          score: { gt: 0 },
          status: { in: ['COMPLETED', 'EXPIRED', 'IN_PROGRESS'] },
          ...sessionPeriodFilter(period),
        },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      })
    if (!entries.length && !candidate) throw new GuessSongAdminLeaderboardError('找不到可补分的有效听听记录', 404, 'SCORE_NOT_FOUND')

    const baseMode = entries[0]?.GuessSongSession.mode || candidate?.mode || mode as GuessSongMode
    const compensation = calculateGuessSongAdminCompensation({ mode: baseMode, correctAnswers, startingStreak })
    const baseScore = entries[0]?.score ?? candidate?.score ?? 0
    const afterScore = baseScore + compensation.totalScore
    const beforeCorrectCount = entries[0]?.correctCount ?? candidate?.correctCount ?? 0
    const beforeMaxStreak = entries[0]?.maxStreak ?? candidate?.maxStreak ?? 0
    const afterMaxStreak = Math.max(beforeMaxStreak, startingStreak + correctAnswers)
    const targetEntry = entries[0]
    if (targetEntry) {
      await tx.guessSongLeaderboardEntry.update({
        where: { id: targetEntry.id },
        data: {
          score: afterScore,
          correctCount: beforeCorrectCount + correctAnswers,
          maxStreak: afterMaxStreak,
        },
      })
    } else if (candidate) {
      await tx.guessSongLeaderboardEntry.create({
        data: {
          userId: input.userId,
          sessionId: candidate.id,
          mode: toPublicGuessSongMode(candidate.mode) as GuessSongMode,
          periodType,
          periodKey: period.periodKey,
          score: afterScore,
          correctCount: beforeCorrectCount + correctAnswers,
          maxStreak: afterMaxStreak,
          totalPlayCount: candidate.totalPlayCount,
          achievedAt: candidate.completedAt || candidate.updatedAt || candidate.createdAt,
        },
      })
    }
    await tx.adminActionLog.create({
      data: {
        adminId: input.adminId,
        targetUserId: input.userId,
        action: 'GUESS_SONG_ADD_SCORE',
        detail: {
          mode,
          periodType,
          periodKey: period.periodKey,
          beforeScore: baseScore,
          adjustment: compensation,
          afterScore,
          beforeCorrectCount,
          afterCorrectCount: beforeCorrectCount + correctAnswers,
          beforeMaxStreak,
          afterMaxStreak,
          sessionId: targetEntry?.sessionId || candidate?.id || null,
          reason,
        },
      },
    })
    return { mode, periodType, periodKey: period.periodKey, compensation, beforeScore: baseScore, afterScore }
  })
}
