import type { GuessSongMode, GuessSongPeriodType } from '@prisma/client'
import {
  GUESS_SONG_BASE_SCORE,
  GUESS_SONG_ADMIN_MAX_BONUS_CORRECT_ANSWERS,
  getGuessSongDatabaseModes,
  isGuessSongPublicMode,
  type GuessSongPublicMode,
  toPublicGuessSongMode,
  calculateGuessSongScore,
} from '@/lib/guess-song-config'
import { compareGuessSongScores, getGuessSongPeriod, selectBestGuessSongRows } from '@/lib/guess-song-period'
import { getGuessSongDeletedSessionIds, getGuessSongDeletedYearSessionIds, recordGuessSongLeaderboard } from '@/lib/guess-song-leaderboard'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-risk'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

export type GuessSongAdminPeriodType = GuessSongPeriodType | 'YEAR'
export const GUESS_SONG_ADMIN_MAX_CORRECT_ANSWERS = GUESS_SONG_ADMIN_MAX_BONUS_CORRECT_ANSWERS
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

function assertPeriodType(value: unknown): asserts value is GuessSongAdminPeriodType {
  if (value === 'YEAR') return
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

function getPeriodBounds(periodType: GuessSongAdminPeriodType, periodKey: string | null | undefined) {
  const current = getGuessSongPeriod(periodType)
  if (!periodKey) return current
  const validFormat = periodType === 'WEEK'
    ? /^\d{4}-\d{2}-\d{2}$/
    : periodType === 'MONTH'
      ? /^\d{4}-\d{2}$/
      : /^\d{4}$/
  if (!validFormat.test(periodKey)) throw new GuessSongAdminLeaderboardError('榜单周期标识无效')
  const reference = periodType === 'WEEK'
    ? new Date(`${periodKey}T12:00:00+08:00`)
    : periodType === 'MONTH'
      ? new Date(`${periodKey}-15T12:00:00+08:00`)
      : new Date(`${periodKey}-07-01T12:00:00+08:00`)
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
  periodType: GuessSongAdminPeriodType
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
    avatarUrl: string | null
    Profile: { displayName: string | null; avatarUrl: string | null } | null
  }
  GuessSongSession: {
    id: string
    status: string
    completedAt: Date | null
    mode: GuessSongMode
    score: number
    correctCount: number
    maxStreak: number
    totalPlayCount: number
    isValid: boolean
    riskScore: number
    questionCount: number | null
    updatedAt: Date
    createdAt: Date
  }
}

type YearSession = {
  id: string
  userId: string
  mode: GuessSongMode
  status: string
  score: number
  correctCount: number
  maxStreak: number
  totalPlayCount: number
  completedAt: Date
  updatedAt: Date
  createdAt: Date
  User: AdminEntry['User']
}

function compareYearSessions(left: YearSession, right: YearSession) {
  return compareGuessSongScores(
    {
      score: left.score,
      correctCount: left.correctCount,
      maxStreak: left.maxStreak,
      totalPlayCount: left.totalPlayCount,
      achievedAt: left.completedAt,
    },
    {
      score: right.score,
      correctCount: right.correctCount,
      maxStreak: right.maxStreak,
      totalPlayCount: right.totalPlayCount,
      achievedAt: right.completedAt,
    },
  )
}

function serializeEntry(entry: AdminEntry, entryIds: string[], databaseMode = entry.mode) {
  return {
    id: entry.id,
    entryIds,
    userId: entry.userId,
    uid: entry.User.uid,
    nickname: entry.User.nickname,
    displayName: getPublicUserDisplayName(entry.User),
    avatarUrl: publicImageUrl(entry.User.Profile?.avatarUrl || entry.User.avatarUrl),
    mode: toPublicGuessSongMode(entry.mode),
    databaseMode,
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

function serializeYearSession(session: YearSession, periodKey: string) {
  return {
    id: session.id,
    entryIds: [],
    userId: session.userId,
    uid: session.User.uid,
    nickname: session.User.nickname,
    displayName: getPublicUserDisplayName(session.User),
    avatarUrl: publicImageUrl(session.User.Profile?.avatarUrl || session.User.avatarUrl),
    mode: toPublicGuessSongMode(session.mode),
    databaseMode: session.mode,
    periodType: 'YEAR' as const,
    periodKey,
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    totalPlayCount: session.totalPlayCount,
    achievedAt: session.completedAt.toISOString(),
    sessionId: session.id,
    sessionStatus: session.status,
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
  if (input.periodType === 'YEAR') {
    const sessions = await prisma.guessSongSession.findMany({
      where: {
        mode: { in: modeValues },
        status: { in: ['COMPLETED', 'EXPIRED'] },
        completedAt: { gte: period.start, lt: period.end },
        isValid: true,
        riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
        ...(input.mode === 'EASY' ? { questionCount: null } : {}),
        User: userSearchFilter(input.query || ''),
      },
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
        updatedAt: true,
        createdAt: true,
        User: {
          select: {
            id: true,
            uid: true,
            nickname: true,
            avatarUrl: true,
            Profile: { select: { displayName: true, avatarUrl: true } },
          },
        },
      },
      orderBy: [
        { score: 'desc' },
        { correctCount: 'desc' },
        { maxStreak: 'desc' },
        { totalPlayCount: 'asc' },
        { completedAt: 'asc' },
        { id: 'asc' },
      ],
    })
    const deletedSessionIds = await getGuessSongDeletedYearSessionIds(period.periodKey)
    const bestByUser = new Map<string, YearSession>()
    for (const session of sessions as YearSession[]) {
      if (deletedSessionIds.has(session.id)) continue
      const current = bestByUser.get(session.userId)
      if (!current || compareYearSessions(session, current) < 0) bestByUser.set(session.userId, session)
    }
    return {
      mode: input.mode,
      periodType: input.periodType,
      periodKey: period.periodKey,
      rows: [...bestByUser.values()]
        .sort(compareYearSessions)
        .map((session) => serializeYearSession(session, period.periodKey)),
    }
  }
  const deletedSessionIds = await getGuessSongDeletedSessionIds({
    mode: input.mode,
    periodType: input.periodType,
    periodKey: period.periodKey,
  })
  const rows = await prisma.guessSongLeaderboardEntry.findMany({
    where: {
      mode: { in: modeValues },
      periodType: input.periodType,
      periodKey: period.periodKey,
      ...(deletedSessionIds.size > 0 ? { sessionId: { notIn: [...deletedSessionIds] } } : {}),
      User: userSearchFilter(input.query || ''),
      GuessSongSession: {
        isValid: true,
        riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
      },
    },
    include: {
      User: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          avatarUrl: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
      GuessSongSession: {
        select: {
          id: true,
          status: true,
          completedAt: true,
          mode: true,
          score: true,
          correctCount: true,
          maxStreak: true,
          totalPlayCount: true,
          isValid: true,
          riskScore: true,
          questionCount: true,
          updatedAt: true,
          createdAt: true,
        },
      },
    },
    orderBy: [{ score: 'desc' }, { achievedAt: 'asc' }],
  })

  // EASY 同时覆盖 EASY/ENDLESS；必须先完整去重，再限制后台展示的 Top 500。
  const entryIdsByUser = new Map<string, string[]>()
  const databaseModeByEntryId = new Map<string, GuessSongMode>()
  for (const row of rows as AdminEntry[]) {
    databaseModeByEntryId.set(row.id, row.mode)
    const entryIds = entryIdsByUser.get(row.userId)
    if (entryIds) entryIds.push(row.id)
    else entryIdsByUser.set(row.userId, [row.id])
  }
  const rankedRows = selectBestGuessSongRows(rows as AdminEntry[])

  return {
    mode: input.mode,
    periodType: input.periodType,
    periodKey: period.periodKey,
    rows: rankedRows
      .slice(0, 500)
      .map((entry) => serializeEntry(
        entry,
        entryIdsByUser.get(entry.userId) || [],
        databaseModeByEntryId.get(entry.id) || entry.mode,
      )),
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
    if (periodType === 'YEAR') {
      const deletedSessionIds = await getGuessSongDeletedYearSessionIds(period.periodKey)
      const candidates = await tx.guessSongSession.findMany({
        where: {
          userId: input.userId,
          mode: { in: getGuessSongDatabaseModes(mode) },
          status: { in: ['COMPLETED', 'EXPIRED'] },
          completedAt: { gte: period.start, lt: period.end },
          isValid: true,
          riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
          ...(mode === 'EASY' ? { questionCount: null } : {}),
        },
        orderBy: [
          { score: 'desc' },
          { correctCount: 'desc' },
          { maxStreak: 'desc' },
          { totalPlayCount: 'asc' },
          { completedAt: 'asc' },
          { id: 'asc' },
        ],
        take: 1000,
      })
      const source = candidates.find((session) => !deletedSessionIds.has(session.id))
      if (!source) throw new GuessSongAdminLeaderboardError('YEAR leaderboard score not found', 404, 'SCORE_NOT_FOUND')
      await tx.adminActionLog.create({
        data: {
          adminId: input.adminId,
          targetUserId: input.userId,
          action: 'GUESS_SONG_DELETE_SCORE',
          detail: {
            mode,
            periodType,
            periodKey: period.periodKey,
            beforeScore: source.score,
            sessionId: source.id,
            reason,
          },
        },
      })
      return { deletedCount: 1, mode, periodType, periodKey: period.periodKey }
    }
    const deletedSessionIds = await getGuessSongDeletedSessionIds({
      mode,
      periodType,
      periodKey: period.periodKey,
    }, tx)
    const entries = await tx.guessSongLeaderboardEntry.findMany({
      where: {
        userId: input.userId,
        mode: { in: getGuessSongDatabaseModes(mode) },
        periodType,
        periodKey: period.periodKey,
        ...(deletedSessionIds.size > 0 ? { sessionId: { notIn: [...deletedSessionIds] } } : {}),
      },
      select: { id: true, score: true, correctCount: true, maxStreak: true, totalPlayCount: true, achievedAt: true, mode: true, sessionId: true },
    })
    if (!entries.length) throw new GuessSongAdminLeaderboardError('该用户没有对应榜单成绩', 404, 'SCORE_NOT_FOUND')
    const source = entries.reduce((best, entry) => compareGuessSongScores(entry, best) < 0 ? entry : best)
    const deletedEntryIds = entries.filter((entry) => entry.sessionId === source.sessionId).map((entry) => entry.id)
    await tx.guessSongLeaderboardEntry.deleteMany({
      where: { id: { in: deletedEntryIds } },
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
          beforeScore: source.score,
          deletedEntryIds,
          sessionIds: [source.sessionId],
          reason,
        },
      },
    })
    const fallback = await tx.guessSongSession.findFirst({
      where: {
        userId: input.userId,
        mode: { in: getGuessSongDatabaseModes(mode) },
        status: { in: ['COMPLETED', 'EXPIRED'] },
        completedAt: { gte: period.start, lt: period.end },
        isValid: true,
        riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
        id: { notIn: [...deletedSessionIds, source.sessionId] },
        ...(mode === 'EASY' ? { questionCount: null } : {}),
      },
      orderBy: [
        { score: 'desc' },
        { correctCount: 'desc' },
        { maxStreak: 'desc' },
        { totalPlayCount: 'asc' },
        { completedAt: 'asc' },
        { id: 'asc' },
      ],
      select: { id: true },
    })
    if (fallback) await recordGuessSongLeaderboard(fallback.id, tx)
    return { deletedCount: deletedEntryIds.length, mode, periodType, periodKey: period.periodKey }
  })
}

async function addGuessSongAdminYearScore(input: {
  adminId: string
  userId: string
  mode: GuessSongPublicMode
  periodKey: string
  period: { start: Date; end: Date }
  correctAnswers: number
  startingStreak: number
  reason: string
}) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!target) throw new GuessSongAdminLeaderboardError('USER_NOT_FOUND', 404, 'USER_NOT_FOUND')
    const deletedSessionIds = await getGuessSongDeletedYearSessionIds(input.periodKey)
    const candidates = await tx.guessSongSession.findMany({
      where: {
        userId: input.userId,
        mode: { in: getGuessSongDatabaseModes(input.mode) },
        status: { in: ['COMPLETED', 'EXPIRED'] },
        completedAt: { gte: input.period.start, lt: input.period.end },
        isValid: true,
        riskScore: { lt: GUESS_SONG_RISK_THRESHOLD },
        ...(input.mode === 'EASY' ? { questionCount: null } : {}),
      },
      orderBy: [
        { score: 'desc' },
        { correctCount: 'desc' },
        { maxStreak: 'desc' },
        { totalPlayCount: 'asc' },
        { completedAt: 'asc' },
        { id: 'asc' },
      ],
      take: 1000,
    })
    const source = candidates.find((session) => !deletedSessionIds.has(session.id))
    if (!source) throw new GuessSongAdminLeaderboardError('SCORE_NOT_FOUND', 404, 'SCORE_NOT_FOUND')
    const compensation = calculateGuessSongAdminCompensation({
      mode: source.mode,
      correctAnswers: input.correctAnswers,
      startingStreak: input.startingStreak,
    })
    const afterScore = source.score + compensation.totalScore
    const afterCorrectCount = source.correctCount + compensation.correctAnswers
    const afterMaxStreak = Math.max(source.maxStreak, input.startingStreak + compensation.correctAnswers)
    await tx.guessSongSession.update({
      where: { id: source.id },
      data: { score: afterScore, correctCount: afterCorrectCount, maxStreak: afterMaxStreak },
    })
    await recordGuessSongLeaderboard(source.id, tx)
    const affectedPeriods = ['WEEK', 'MONTH'].map((periodType) => ({
      periodType,
      periodKey: getGuessSongPeriod(periodType as GuessSongPeriodType, source.completedAt!).periodKey,
      score: afterScore,
    }))
    await tx.adminActionLog.create({
      data: {
        adminId: input.adminId,
        targetUserId: input.userId,
        action: 'GUESS_SONG_ADD_SCORE',
        detail: {
          mode: input.mode,
          periodType: 'YEAR',
          periodKey: input.periodKey,
          beforeScore: source.score,
          adjustment: compensation,
          afterScore,
          beforeCorrectCount: source.correctCount,
          afterCorrectCount,
          beforeMaxStreak: source.maxStreak,
          afterMaxStreak,
          sourceSessionId: source.id,
          affectedPeriods,
          reason: input.reason,
        },
      },
    })
    return {
      mode: input.mode,
      periodType: 'YEAR' as const,
      periodKey: input.periodKey,
      compensation,
      beforeScore: source.score,
      afterScore,
      affectedPeriods,
    }
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

  if (periodType === 'YEAR') {
    return addGuessSongAdminYearScore({
      adminId: input.adminId,
      userId: input.userId,
      mode,
      periodKey: period.periodKey,
      period,
      correctAnswers,
      startingStreak,
      reason,
    })
  }

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!target) throw new GuessSongAdminLeaderboardError('用户不存在', 404, 'USER_NOT_FOUND')
    const modeValues = getGuessSongDatabaseModes(mode)
    const deletedSessionIds = await getGuessSongDeletedSessionIds({
      mode,
      periodType,
      periodKey: period.periodKey,
    }, tx)
    const entries = await tx.guessSongLeaderboardEntry.findMany({
      where: {
        userId: input.userId,
        mode: { in: modeValues },
        periodType: periodType as GuessSongPeriodType,
        periodKey: period.periodKey,
        ...(deletedSessionIds.size > 0 ? { sessionId: { notIn: [...deletedSessionIds] } } : {}),
      },
      include: {
        GuessSongSession: {
          select: {
            id: true,
            status: true,
            completedAt: true,
            mode: true,
            score: true,
            correctCount: true,
            maxStreak: true,
            totalPlayCount: true,
            isValid: true,
            riskScore: true,
            questionCount: true,
            updatedAt: true,
            createdAt: true,
          },
        },
      },
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
          status: { in: ['COMPLETED', 'EXPIRED'] },
          completedAt: { gte: period.start, lt: period.end },
          ...(deletedSessionIds.size > 0 ? { id: { notIn: [...deletedSessionIds] } } : {}),
          ...(mode === 'EASY' ? { questionCount: null } : {}),
        },
        orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      })
    if (!entries.length && !candidate) throw new GuessSongAdminLeaderboardError('找不到可补分的有效听听记录', 404, 'SCORE_NOT_FOUND')

    const targetEntry = entries[0]
    const sourceSession = targetEntry?.GuessSongSession || candidate
    if (!sourceSession || !['COMPLETED', 'EXPIRED'].includes(sourceSession.status) || !sourceSession.completedAt) {
      throw new GuessSongAdminLeaderboardError('SCORE_NOT_FOUND', 404, 'SCORE_NOT_FOUND')
    }
    if (sourceSession.mode === 'EASY' && sourceSession.questionCount !== null) {
      throw new GuessSongAdminLeaderboardError('SCORE_NOT_FOUND', 404, 'SCORE_NOT_FOUND')
    }
    const baseMode = sourceSession.mode
    const compensation = calculateGuessSongAdminCompensation({ mode: baseMode, correctAnswers, startingStreak })
    const baseScore = Math.max(targetEntry?.score ?? 0, sourceSession.score)
    const afterScore = baseScore + compensation.totalScore
    const beforeCorrectCount = Math.max(targetEntry?.correctCount ?? 0, sourceSession.correctCount)
    const afterCorrectCount = beforeCorrectCount + correctAnswers
    const beforeMaxStreak = Math.max(targetEntry?.maxStreak ?? 0, sourceSession.maxStreak)
    const afterMaxStreak = Math.max(beforeMaxStreak, startingStreak + correctAnswers)
    await tx.guessSongSession.update({
      where: { id: sourceSession.id },
      data: {
        score: afterScore,
        correctCount: afterCorrectCount,
        maxStreak: afterMaxStreak,
      },
    })
    await recordGuessSongLeaderboard(sourceSession.id, tx)
    const affectedPeriods = ['WEEK', 'MONTH'].map((affectedPeriodType) => ({
      periodType: affectedPeriodType,
      periodKey: getGuessSongPeriod(affectedPeriodType as GuessSongPeriodType, sourceSession.completedAt!).periodKey,
      score: afterScore,
    }))
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
          afterCorrectCount,
          beforeMaxStreak,
          afterMaxStreak,
          sourceSessionId: sourceSession.id,
          affectedPeriods,
          reason,
        },
      },
    })
    return {
      mode,
      periodType,
      periodKey: period.periodKey,
      compensation,
      beforeScore: baseScore,
      afterScore,
      affectedPeriods,
    }
  })
}
