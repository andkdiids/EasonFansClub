import type { Prisma, WantListenMode, WantListenPeriodType } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { WANT_LISTEN_MAX_WRONG_COUNT } from '@/lib/want-listen-config'
import { recordWantListenLeaderboard, recomputeUserWantListenLeaderboard } from '@/lib/want-listen-leaderboard'
import { getWantListenPeriod, isWantListenScoreBetter, parseWantListenPeriod } from '@/lib/want-listen-period'
import { computeWantListenManualBackfill, validateWantListenScoreConsistency } from '@/lib/want-listen-score'

export class WantListenAdminLeaderboardError extends Error {
  constructor(readonly message: string, readonly status = 400, readonly code = 'ADMIN_LEADERBOARD_ERROR') {
    super(message)
    this.name = 'WantListenAdminLeaderboardError'
  }
}

export const WANT_LISTEN_ADMIN_MODES = ['WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE'] as const
export type WantListenAdminMode = (typeof WANT_LISTEN_ADMIN_MODES)[number]

const MODE_LABELS: Record<WantListenAdminMode, string> = {
  WANT_LISTEN: '想听',
  CANTONESE_FRAGMENT: '粤语残片',
  FALSE_TITLE: '防不胜防',
}

export const LEADERBOARD_CLEAR_ACTIONS = ['CLEAR_ALL', 'CLEAR_MODE', 'CLEAR_USER'] as const
export type LeaderboardClearAction = (typeof LEADERBOARD_CLEAR_ACTIONS)[number]

export function isWantListenAdminMode(value: unknown): value is WantListenAdminMode {
  return value === 'WANT_LISTEN' || value === 'CANTONESE_FRAGMENT' || value === 'FALSE_TITLE'
}

export function isLeaderboardClearAction(value: unknown): value is LeaderboardClearAction {
  return value === 'CLEAR_ALL' || value === 'CLEAR_MODE' || value === 'CLEAR_USER'
}

export function leaderboardModeLabel(mode: WantListenAdminMode) {
  return MODE_LABELS[mode]
}

export function startOfDay(now = new Date()) {
  const period = getWantListenPeriod('DAY', now)
  if (!period.start) throw new Error('DAY 周期必须有开始时间')
  return period.start
}

/** 本周一 00:00（周一为一周起点） */
export function startOfWeek(now = new Date()) {
  const period = getWantListenPeriod('WEEK', now)
  if (!period.start) throw new Error('WEEK 周期必须有开始时间')
  return period.start
}

type OverviewUser = {
  id: string
  uid: number
  nickname: string
  avatarUrl: string | null
  nicknameModerationStatus: string
  Profile: { displayName: string | null; avatarUrl: string | null; displayNameModerationStatus: string } | null
}

function serializeOverviewUser(user: OverviewUser | null | undefined) {
  if (!user) return null
  return {
    id: user.id,
    uid: user.uid,
    nickname: getPublicUserDisplayName(user),
    avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
  }
}

/** 排行榜总览：三个模式各自的记录数 / 今日新增 / 本周新增 / 最高分用户 / 最近更新时间 */
export async function getWantListenAdminOverview() {
  const now = new Date()
  const todayStart = startOfDay(now)
  const weekStart = startOfWeek(now)
  const overview: Array<{
    mode: WantListenAdminMode
    label: string
    total: number
    todayCount: number
    weekCount: number
    topUser: ReturnType<typeof serializeOverviewUser>
    topScore: number | null
    lastUpdatedAt: string | null
  }> = []

  for (const mode of WANT_LISTEN_ADMIN_MODES) {
    const [total, todayCount, weekCount, top, latest] = await Promise.all([
      prisma.wantListenLeaderboardEntry.count({ where: { mode } }),
      prisma.wantListenLeaderboardEntry.count({ where: { mode, createdAt: { gte: todayStart } } }),
      prisma.wantListenLeaderboardEntry.count({ where: { mode, createdAt: { gte: weekStart } } }),
      prisma.wantListenLeaderboardEntry.findFirst({
        where: { mode },
        orderBy: [{ score: 'desc' }, { correctCount: 'desc' }, { completionTimeMs: 'asc' }, { achievedAt: 'asc' }],
        include: {
          User: {
            select: {
              id: true,
              uid: true,
              nickname: true,
              avatarUrl: true,
              nicknameModerationStatus: true,
              nicknameViolationDisplay: true,
              Profile: { select: { displayName: true, avatarUrl: true, displayNameModerationStatus: true } },
            },
          },
        },
      }),
      prisma.wantListenLeaderboardEntry.findFirst({ where: { mode }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    ])
    overview.push({
      mode,
      label: MODE_LABELS[mode],
      total,
      todayCount,
      weekCount,
      topUser: serializeOverviewUser(top?.User),
      topScore: top?.score ?? null,
      lastUpdatedAt: latest?.updatedAt?.toISOString() ?? null,
    })
  }

  return {
    overview,
    totalAll: overview.reduce((sum, item) => sum + item.total, 0),
    generatedAt: now.toISOString(),
  }
}

/** 按 UID / 昵称查询用户及其当前各模式排行榜成绩 */
export async function findWantListenLeaderboardUser(rawQuery: string) {
  const query = rawQuery.trim().slice(0, 80)
  if (!query) throw new WantListenAdminLeaderboardError('请输入用户 UID 或昵称')
  const uid = /^\d+$/.test(query) ? Number(query) : null
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { uid: uid ?? -1 },
        { nickname: { contains: query } },
        { username: { contains: query } },
      ],
    },
    select: {
      id: true,
      uid: true,
      nickname: true,
      avatarUrl: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      Profile: { select: { displayName: true, avatarUrl: true, displayNameModerationStatus: true } },
    },
  })
  if (!user) throw new WantListenAdminLeaderboardError('未找到该用户', 404, 'USER_NOT_FOUND')

  const scores: Array<{
    mode: WantListenAdminMode
    label: string
    score: number
    correctCount: number
    completionTimeMs: number | null
    achievedAt: string | null
  }> = []
  for (const mode of WANT_LISTEN_ADMIN_MODES) {
    const entry = await prisma.wantListenLeaderboardEntry.findFirst({
      where: { userId: user.id, mode },
      orderBy: [{ score: 'desc' }, { correctCount: 'desc' }, { completionTimeMs: 'asc' }, { achievedAt: 'asc' }],
    })
    scores.push({
      mode,
      label: MODE_LABELS[mode],
      score: entry?.score ?? 0,
      correctCount: entry?.correctCount ?? 0,
      completionTimeMs: entry?.completionTimeMs ?? null,
      achievedAt: entry?.achievedAt?.toISOString() ?? null,
    })
  }

  return {
    user: {
      id: user.id,
      uid: user.uid,
      nickname: getPublicUserDisplayName(user),
      avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
    },
    totalEntries: await prisma.wantListenLeaderboardEntry.count({ where: { userId: user.id } }),
    scores,
    recoverableSessions: (await listRecoverableWantListenSessions(user.id)).sessions,
  }
}

/**
 * 清除想听排行榜成绩（仅 WantListenLeaderboardEntry）。
 * CLEAR_ALL：清空全部模式；CLEAR_MODE：按模式；CLEAR_USER：按用户。
 * 事务内：先计数 → 删除 → 写 LeaderboardAdminLog。
 */
export async function clearWantListenAdminLeaderboard(input: {
  adminId: string
  adminUid?: number | null
  adminNickname?: string | null
  adminUsername?: string | null
  action: unknown
  mode?: unknown
  targetUserId?: unknown
  reason?: unknown
}) {
  if (!isLeaderboardClearAction(input.action)) throw new WantListenAdminLeaderboardError('管理操作无效', 400, 'INVALID_ACTION')
  const action: LeaderboardClearAction = input.action
  const reason = String(input.reason || '').trim().slice(0, 200)
  if (reason.length < 2) throw new WantListenAdminLeaderboardError('请填写清除原因')

  let mode: WantListenMode | null = null
  if (action === 'CLEAR_MODE') {
    if (!isWantListenAdminMode(input.mode)) throw new WantListenAdminLeaderboardError('请选择有效的游戏模式')
    mode = input.mode
  }

  let targetUserId: string | null = null
  if (action === 'CLEAR_USER') {
    targetUserId = String(input.targetUserId || '').trim()
    if (!targetUserId) throw new WantListenAdminLeaderboardError('请提供要清除的用户')
  }

  return prisma.$transaction(async (tx) => {
    const where: Prisma.WantListenLeaderboardEntryWhereInput = {}
    if (mode) where.mode = mode
    if (targetUserId) where.userId = targetUserId

    const beforeCount = await tx.wantListenLeaderboardEntry.count({ where })
    const { count } = await tx.wantListenLeaderboardEntry.deleteMany({ where })
    await tx.leaderboardAdminLog.create({
      data: {
        adminId: input.adminId,
        action,
        targetUserId: targetUserId ?? undefined,
        gameType: action === 'CLEAR_MODE' ? mode ?? undefined : action === 'CLEAR_ALL' ? 'ALL' : undefined,
        deletedCount: count,
        reason,
        adminUid: input.adminUid ?? null,
        adminNickname: input.adminNickname?.slice(0, 64) || null,
        adminUsername: input.adminUsername?.slice(0, 64) || null,
      },
    })
    return {
      action,
      deletedCount: count,
      beforeCount,
      mode: mode ?? null,
      targetUserId,
    }
  })
}

// ---------- 排行榜补分（复用听听补分的布局与机制，数据逻辑为「覆盖取最高」） ----------

export const WANT_LISTEN_ADMIN_PERIODS: Array<{ value: WantListenPeriodType; label: string }> = [
  { value: 'DAY', label: '今日榜' },
  { value: 'WEEK', label: '本周榜' },
  { value: 'ALL', label: '全部榜' },
]

type AdminEntryRow = {
  id: string
  userId: string
  uid: number
  displayName: string
  mode: WantListenMode
  periodType: WantListenPeriodType
  periodKey: string
  score: number
  correctCount: number
  maxStreak: number
  totalQuestions: number
  completionTimeMs: number | null
  achievedAt: Date
  sessionId: string | null
  sessionStatus: string | null
}

/** 补分用榜单行列表：按模式 + 周期 + 搜索用户（UID/昵称） */
export async function listWantListenAdminLeaderboard(input: { mode: unknown; period?: unknown; query?: string }) {
  if (!isWantListenAdminMode(input.mode)) throw new WantListenAdminLeaderboardError('请选择有效的游戏模式')
  const mode = input.mode
  const periodType = parseWantListenPeriod(input.period)
  const period = getWantListenPeriod(periodType)
  const query = String(input.query || '').trim().slice(0, 80)
  const numericQuery = /^\d+$/.test(query) ? Number(query) : null
  const rows = await prisma.wantListenLeaderboardEntry.findMany({
    where: {
      mode,
      periodType,
      periodKey: period.periodKey,
      ...(query
        ? {
          User: {
            OR: [
              { uid: numericQuery ?? -1 },
              { nickname: { contains: query } },
              { username: { contains: query } },
            ],
          },
        }
        : {}),
    },
    orderBy: [
      { score: 'desc' },
      { correctCount: 'desc' },
      { maxStreak: 'desc' },
      { completionTimeMs: 'asc' },
      { achievedAt: 'asc' },
      { id: 'asc' },
    ],
    take: 500,
    include: {
      User: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          avatarUrl: true,
          nicknameModerationStatus: true,
          Profile: { select: { displayName: true, avatarUrl: true, displayNameModerationStatus: true } },
        },
      },
      WantListenSession: { select: { id: true, status: true } },
    },
  })

  const serialized: AdminEntryRow[] = rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    uid: row.User.uid,
    displayName: getPublicUserDisplayName(row.User),
    mode: row.mode,
    periodType: row.periodType,
    periodKey: row.periodKey,
    score: row.score,
    correctCount: row.correctCount,
    maxStreak: row.maxStreak,
    totalQuestions: row.totalQuestions,
    completionTimeMs: row.completionTimeMs,
    achievedAt: row.achievedAt,
    sessionId: row.WantListenSession?.id ?? null,
    sessionStatus: row.WantListenSession?.status ?? null,
  }))

  return { mode, periodType, periodKey: period.periodKey, rows: serialized }
}

function parseAchievedAt(value: unknown) {
  if (value === undefined || value === null || value === '') return new Date()
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

/** 读取指定游戏 Session 的数据（补分「从异常 Session 读取」预填用） */
export async function readWantListenAdminSession(rawSessionId: unknown) {
  const sessionId = String(rawSessionId || '').trim().slice(0, 64)
  if (!sessionId) throw new WantListenAdminLeaderboardError('请提供 Session ID')
  const session = await prisma.wantListenSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      userId: true,
      mode: true,
      status: true,
      score: true,
      correctCount: true,
      maxStreak: true,
      currentStreak: true,
      wrongCount: true,
      livesRemaining: true,
      totalQuestions: true,
      completionTimeMs: true,
      startedAt: true,
      completedAt: true,
      updatedAt: true,
      expiresAt: true,
      antiCheatStatus: true,
      User: { select: { id: true, uid: true, nickname: true, avatarUrl: true, nicknameModerationStatus: true, Profile: { select: { displayName: true, avatarUrl: true, displayNameModerationStatus: true } } } },
    },
  })
  if (!session) throw new WantListenAdminLeaderboardError('未找到该游戏记录', 404, 'SESSION_NOT_FOUND')
  return {
    id: session.id,
    userId: session.userId,
    mode: session.mode,
    status: session.status,
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    currentStreak: session.currentStreak,
    wrongCount: session.wrongCount,
    livesRemaining: session.livesRemaining,
    totalQuestions: session.totalQuestions,
    completionTimeMs: session.completionTimeMs,
    startedAt: session.startedAt.toISOString(),
    completedAt: session.completedAt?.toISOString() ?? null,
    lastActiveAt: session.updatedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    antiCheatStatus: session.antiCheatStatus,
    user: {
      id: session.User.id,
      uid: session.User.uid,
      nickname: getPublicUserDisplayName(session.User),
      avatarUrl: publicImageUrl(session.User.Profile?.avatarUrl || session.User.avatarUrl),
    },
  }
}

// ---------- 想听排行榜补录（统一计分，禁止直接填写分数） ----------

export const WANT_LISTEN_ADMIN_MAX_CORRECT_DELTA = 1000
export const WANT_LISTEN_ADMIN_MAX_WRONG_DELTA = 1000
export const WANT_LISTEN_ADMIN_MAX_STARTING_STREAK = 10_000

export type WantListenBackfillType = 'SESSION_RECOVERY' | 'MANUAL_QUESTION_ADJUSTMENT'

function assertBackfillType(value: unknown): WantListenBackfillType {
  if (value === 'SESSION_RECOVERY') return 'SESSION_RECOVERY'
  if (value === 'MANUAL_QUESTION_ADJUSTMENT') return 'MANUAL_QUESTION_ADJUSTMENT'
  throw new WantListenAdminLeaderboardError('请选择补录方式（异常游戏恢复或人工补题）')
}

function toBackfillInteger(value: unknown, label: string, max: number, min = 1) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new WantListenAdminLeaderboardError(`${label}必须是 ${min}-${max} 的整数`)
  }
  return parsed
}

function affectedPeriodsOf(achievedAt: Date) {
  return (['DAY', 'WEEK', 'ALL'] as const).map((periodType) => {
    const period = getWantListenPeriod(periodType, achievedAt)
    return { periodType, periodKey: period.periodKey }
  })
}

type BackfillTx = Prisma.TransactionClient

/** 该用户异常中断（IN_PROGRESS / EXPIRED）的可恢复游戏记录 */
export async function listRecoverableWantListenSessions(userId: unknown, mode?: unknown) {
  const targetUserId = String(userId || '').trim()
  if (!targetUserId) throw new WantListenAdminLeaderboardError('请提供用户 ID')
  const sessions = await prisma.wantListenSession.findMany({
    where: {
      userId: targetUserId,
      ...(isWantListenAdminMode(mode) ? { mode } : {}),
      status: { in: ['IN_PROGRESS', 'EXPIRED'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      mode: true,
      status: true,
      score: true,
      correctCount: true,
      maxStreak: true,
      totalQuestions: true,
      currentStreak: true,
      wrongCount: true,
      startedAt: true,
      updatedAt: true,
      antiCheatStatus: true,
    },
  })
  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      mode: session.mode,
      status: session.status,
      score: session.score,
      correctCount: session.correctCount,
      maxStreak: session.maxStreak,
      totalQuestions: session.totalQuestions,
      currentStreak: session.currentStreak,
      wrongCount: session.wrongCount,
      startedAt: session.startedAt.toISOString(),
      lastActiveAt: session.updatedAt.toISOString(),
      antiCheatStatus: session.antiCheatStatus,
    })),
  }
}

/**
 * 想听排行榜补录统一入口（异常 Session 恢复 / 人工补题）。
 *
 *  - dryRun=true  ：仅计算预览（PREVIEW_BACKFILL），不落库、不写审计日志
 *  - dryRun=false ：确认补录（BACKFILL）
 *
 * 服务端不再接受「直接填写 score」，分数一律由 calculateWantListenBackfillScore
 * 计算（与前台 scoreForWantListenAnswer 同一套公式），并做一致性校验
 * （correctCount <= totalQuestions、score 必须能被游戏规则推导）。
 */
export async function previewOrApplyWantListenBackfill(input: {
  adminId: string
  userId: string
  mode: unknown
  type: unknown
  sessionId?: unknown
  correctDelta?: unknown
  wrongDelta?: unknown
  startingStreak?: unknown
  playedAt?: unknown
  reason?: unknown
  dryRun?: boolean
}) {
  if (!isWantListenAdminMode(input.mode)) throw new WantListenAdminLeaderboardError('请选择有效的游戏模式')
  const mode = input.mode
  const type = assertBackfillType(input.type)
  const reason = String(input.reason || '').trim().slice(0, 200)
  const dryRun = input.dryRun === true
  if (!dryRun && reason.length < 2) throw new WantListenAdminLeaderboardError('请填写补录原因')

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!target) throw new WantListenAdminLeaderboardError('用户不存在', 404, 'USER_NOT_FOUND')

    if (type === 'SESSION_RECOVERY') {
      return recoverWantListenSession(tx, { adminId: input.adminId, userId: input.userId, mode, sessionId: input.sessionId, reason, dryRun })
    }
    return adjustWantListenManual(tx, {
      adminId: input.adminId,
      userId: input.userId,
      mode,
      sessionId: input.sessionId,
      correctDelta: input.correctDelta,
      wrongDelta: input.wrongDelta,
      startingStreak: input.startingStreak,
      playedAt: input.playedAt,
      reason,
      dryRun,
    })
  })
}

/** 异常 Session 恢复：直接采用该 Session 权威成绩，不重新计算、不人工输入分数 */
async function recoverWantListenSession(
  tx: BackfillTx,
  input: { adminId: string; userId: string; mode: WantListenMode; sessionId?: unknown; reason: string; dryRun: boolean },
) {
  const sessionId = String(input.sessionId || '').trim().slice(0, 64)
  if (!sessionId) throw new WantListenAdminLeaderboardError('请提供要恢复的游戏记录 Session ID')
  const session = await tx.wantListenSession.findFirst({ where: { id: sessionId, userId: input.userId, mode: input.mode } })
  if (!session) throw new WantListenAdminLeaderboardError('未找到该游戏记录', 404, 'SESSION_NOT_FOUND')
  if (!['IN_PROGRESS', 'EXPIRED', 'COMPLETED'].includes(session.status)) {
    throw new WantListenAdminLeaderboardError('该游戏记录状态不可恢复', 400, 'SESSION_NOT_RECOVERABLE')
  }

  const authoritative = {
    score: session.score,
    correctCount: session.correctCount,
    maxStreak: session.maxStreak,
    totalQuestions: session.totalQuestions,
  }
  const validation = validateWantListenScoreConsistency(authoritative, input.mode)
  if (!validation.ok) {
    throw new WantListenAdminLeaderboardError(
      `该游戏记录成绩与计分规则不一致（${validation.reason}），请改用手工补题或先运行 pnpm leaderboard:audit / leaderboard:repair`,
      400,
      'INVALID_SCORE_ADJUSTMENT',
    )
  }

  // 成绩发生时间以最后活跃时间（updatedAt）为准；恢复不人工指定分数
  const playedAt = session.updatedAt
  const affectedPeriods = affectedPeriodsOf(playedAt)
  const existingEntry = await tx.wantListenLeaderboardEntry.findFirst({
    where: { userId: input.userId, mode: input.mode },
    orderBy: [{ score: 'desc' }, { correctCount: 'desc' }, { maxStreak: 'desc' }, { achievedAt: 'asc' }],
    select: { score: true, correctCount: true, maxStreak: true, totalQuestions: true, completionTimeMs: true, achievedAt: true },
  })
  const leaderboardUpdated = !existingEntry
    || isWantListenScoreBetter(
      { ...authoritative, completionTimeMs: session.completionTimeMs ?? 0, achievedAt: playedAt },
      existingEntry,
    )

  if (input.dryRun) {
    return {
      type: 'SESSION_RECOVERY' as const,
      dryRun: true,
      applied: true,
      sessionId: session.id,
      mode: input.mode,
      status: session.status,
      playedAt: playedAt.toISOString(),
      before: authoritative,
      after: authoritative,
      affectedPeriods,
      leaderboardUpdated,
      reason: input.reason,
    }
  }

  if (session.status !== 'COMPLETED') {
    await tx.wantListenSession.update({
      where: { id: session.id },
      data: {
        status: 'COMPLETED',
        completedAt: playedAt,
        completionTimeMs: Math.max(0, playedAt.getTime() - session.startedAt.getTime()),
        activeKey: null,
      },
    })
  }
  // 以该 Session 权威数据重新聚合当日 / 本周 / 全部榜
  await recordWantListenLeaderboard(session.id, tx)

  await tx.adminActionLog.create({
    data: {
      adminId: input.adminId,
      targetUserId: input.userId,
      action: 'WANT_LISTEN_SESSION_RECOVERY',
      detail: {
        type: 'SESSION_RECOVERY',
        gameMode: input.mode,
        sourceSessionId: session.id,
        operatorId: input.adminId,
        targetUserId: input.userId,
        beforeScore: session.score,
        afterScore: session.score,
        beforeCorrectCount: session.correctCount,
        afterCorrectCount: session.correctCount,
        beforeCompletedCount: session.totalQuestions,
        afterCompletedCount: session.totalQuestions,
        beforeMaxStreak: session.maxStreak,
        afterMaxStreak: session.maxStreak,
        playedAt: playedAt.toISOString(),
        affectedPeriods,
        leaderboardUpdated,
        reason: input.reason,
      },
    },
  })

  return {
    type: 'SESSION_RECOVERY' as const,
    dryRun: false,
    applied: true,
    sessionId: session.id,
    mode: input.mode,
    status: 'COMPLETED',
    playedAt: playedAt.toISOString(),
    before: authoritative,
    after: authoritative,
    affectedPeriods,
    leaderboardUpdated,
    reason: input.reason,
  }
}

/** 人工补题：补回答对 / 答错题数，系统按统一计分规则自动计算分数（不得手填分数） */
async function adjustWantListenManual(
  tx: BackfillTx,
  input: {
    adminId: string
    userId: string
    mode: WantListenMode
    sessionId?: unknown
    correctDelta?: unknown
    wrongDelta?: unknown
    startingStreak?: unknown
    playedAt?: unknown
    reason: string
    dryRun: boolean
  },
) {
  const correctDelta = toBackfillInteger(input.correctDelta, '补回答对题数', WANT_LISTEN_ADMIN_MAX_CORRECT_DELTA)
  const wrongDelta = toBackfillInteger(input.wrongDelta, '补回答错题数', WANT_LISTEN_ADMIN_MAX_WRONG_DELTA, 0)
  const playedAt = parseAchievedAt(input.playedAt)
  if (!playedAt) throw new WantListenAdminLeaderboardError('成绩发生时间无效')

  const sessionId = String(input.sessionId || '').trim().slice(0, 64) || null
  let baseSession: Awaited<ReturnType<BackfillTx['wantListenSession']['findFirst']>> | null = null
  if (sessionId) {
    baseSession = await tx.wantListenSession.findFirst({ where: { id: sessionId, userId: input.userId, mode: input.mode } })
    if (!baseSession) throw new WantListenAdminLeaderboardError('未找到该游戏记录', 404, 'SESSION_NOT_FOUND')
  } else {
    // 未指定 Session：以该用户当前最高成绩对应的 Session（或最近一次有效成绩）为基数
    const baseEntry = await tx.wantListenLeaderboardEntry.findFirst({
      where: { userId: input.userId, mode: input.mode },
      orderBy: [{ score: 'desc' }, { correctCount: 'desc' }, { maxStreak: 'desc' }, { achievedAt: 'asc' }],
    })
    if (baseEntry) baseSession = await tx.wantListenSession.findUnique({ where: { id: baseEntry.sessionId } })
    if (!baseSession) {
      baseSession = await tx.wantListenSession.findFirst({
        where: { userId: input.userId, mode: input.mode, status: { in: ['COMPLETED', 'EXPIRED'] } },
        orderBy: [{ updatedAt: 'desc' }],
      })
    }
  }

  const before = baseSession
    ? { score: baseSession.score, correctCount: baseSession.correctCount, maxStreak: baseSession.maxStreak, totalQuestions: baseSession.totalQuestions }
    : { score: 0, correctCount: 0, maxStreak: 0, totalQuestions: 0 }
  // 已有 Session 时优先自动读取当前连击（不让管理员手填）；无 Session 时才使用输入值（默认 0）
  const startingStreak = baseSession
    ? baseSession.currentStreak
    : toBackfillInteger(input.startingStreak, '补分开始前连击', WANT_LISTEN_ADMIN_MAX_STARTING_STREAK, 0)

  const computed = computeWantListenManualBackfill({ base: before, correctDelta, wrongDelta, startingStreak })
  if (!computed.validation.ok) {
    throw new WantListenAdminLeaderboardError(
      `补录后的成绩与游戏计分规则不一致（${computed.validation.reason}）`,
      400,
      'INVALID_SCORE_ADJUSTMENT',
    )
  }

  const affectedPeriods = affectedPeriodsOf(playedAt)
  const summary = {
    type: 'MANUAL_QUESTION_ADJUSTMENT' as const,
    mode: input.mode,
    correctDelta,
    wrongDelta,
    startingStreak,
    before,
    after: computed.after,
    afterScore: computed.afterScore,
    afterCorrect: computed.afterCorrect,
    afterTotal: computed.afterTotal,
    afterMaxStreak: computed.afterMaxStreak,
    compensation: computed.compensation,
    affectedPeriods,
    playedAt: playedAt.toISOString(),
    reason: input.reason,
  }
  if (input.dryRun) return { ...summary, dryRun: true, sessionId: baseSession?.id ?? null }

  let sourceSessionId: string
  if (baseSession) {
    await tx.wantListenSession.update({
      where: { id: baseSession.id },
      data: {
        score: computed.afterScore,
        correctCount: computed.afterCorrect,
        maxStreak: computed.afterMaxStreak,
        totalQuestions: computed.afterTotal,
        wrongCount: baseSession.wrongCount + wrongDelta,
        currentStreak: computed.compensation.endStreak,
        status: 'COMPLETED',
        completedAt: playedAt,
        completionTimeMs: baseSession.completionTimeMs ?? Math.max(0, playedAt.getTime() - baseSession.startedAt.getTime()),
        activeKey: null,
      },
    })
    sourceSessionId = baseSession.id
  } else {
    const created = await tx.wantListenSession.create({
      data: {
        userId: input.userId,
        mode: input.mode,
        status: 'COMPLETED',
        currentQuestion: 1,
        questionCount: null,
        totalQuestions: computed.afterTotal,
        currentStreak: computed.compensation.endStreak,
        maxStreak: computed.afterMaxStreak,
        wrongCount: wrongDelta,
        livesRemaining: WANT_LISTEN_MAX_WRONG_COUNT,
        score: computed.afterScore,
        correctCount: computed.afterCorrect,
        startedAt: playedAt,
        completedAt: playedAt,
        completionTimeMs: 0,
        expiresAt: playedAt,
        antiCheatStatus: 'CLEAN',
        ipAddress: 'admin-backfill',
        userAgent: 'admin-backfill',
      },
      select: { id: true },
    })
    sourceSessionId = created.id
  }
  await recordWantListenLeaderboard(sourceSessionId, tx)

  await tx.adminActionLog.create({
    data: {
      adminId: input.adminId,
      targetUserId: input.userId,
      action: 'WANT_LISTEN_MANUAL_ADJUSTMENT',
      detail: {
        type: 'MANUAL_QUESTION_ADJUSTMENT',
        gameMode: input.mode,
        sourceSessionId,
        operatorId: input.adminId,
        targetUserId: input.userId,
        beforeScore: before.score,
        afterScore: computed.afterScore,
        beforeCorrectCount: before.correctCount,
        afterCorrectCount: computed.afterCorrect,
        beforeCompletedCount: before.totalQuestions,
        afterCompletedCount: computed.afterTotal,
        beforeMaxStreak: before.maxStreak,
        afterMaxStreak: computed.afterMaxStreak,
        correctDelta,
        wrongDelta,
        startingStreak,
        compensation: computed.compensation,
        playedAt: playedAt.toISOString(),
        affectedPeriods,
        reason: input.reason,
      },
    },
  })

  return { ...summary, dryRun: false, sessionId: sourceSessionId }
}

// ---------- 想听排行榜：精确删除某用户的单条成绩 ----------

/**
 * 精确删除某用户在某个模式下的某条排行榜成绩。
 *
 * 关键：排行榜数据来源于 WantListenSession → recordWantListenLeaderboard → WantListenLeaderboardEntry，
 * 因此删除不能只 DELETE LeaderboardEntry（否则后续聚合 / 补分 / repair 会再次生成）。
 * 正确做法：
 *   1) 标记该 source Session 的 excludedFromLeaderboard = true（保留游戏历史 / 答题记录 / 审计记录）
 *   2) 删除该 Session 产生的全部 LeaderboardEntry（跨 DAY / WEEK / ALL）
 *   3) 从该用户剩余「合法」Session 重新聚合（被排除 Session 因 excludedFromLeaderboard 被过滤）
 *   4) 写 AdminActionLog（WANT_LISTEN_DELETE_SCORE）
 * 仅影响 目标 userId + 目标 mode + 该 Session；不影响其他用户 / 其他模式 / 该用户其他合法成绩。
 */
export async function deleteWantListenUserScore(input: {
  adminId: string
  userId: string
  mode: unknown
  sessionId: unknown
  reason?: unknown
}) {
  if (!isWantListenAdminMode(input.mode)) throw new WantListenAdminLeaderboardError('请选择有效的游戏模式')
  const mode = input.mode
  const reason = String(input.reason || '').trim().slice(0, 200)
  if (reason.length < 2) throw new WantListenAdminLeaderboardError('请填写删除原因')
  const sessionId = String(input.sessionId || '').trim().slice(0, 64)
  if (!sessionId) throw new WantListenAdminLeaderboardError('请提供要删除的成绩对应的 Session ID')

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!target) throw new WantListenAdminLeaderboardError('用户不存在', 404, 'USER_NOT_FOUND')

    const session = await tx.wantListenSession.findFirst({
      where: { id: sessionId, userId: input.userId, mode },
      select: {
        id: true,
        score: true,
        correctCount: true,
        maxStreak: true,
        totalQuestions: true,
        completedAt: true,
        excludedFromLeaderboard: true,
        User: { select: { id: true, uid: true, nickname: true, Profile: { select: { displayName: true } } } },
      },
    })
    if (!session) throw new WantListenAdminLeaderboardError('未找到该游戏记录', 404, 'SESSION_NOT_FOUND')
    if (session.excludedFromLeaderboard) {
      throw new WantListenAdminLeaderboardError('该成绩已被排除出排行榜', 400, 'ALREADY_EXCLUDED')
    }

    // 1) 记录被删除前该 Session 在各周期贡献的成绩（用于 periodsAffected / 前后对比）
    const beforeEntries = await tx.wantListenLeaderboardEntry.findMany({
      where: { sessionId: session.id },
      select: { periodType: true, periodKey: true, score: true, correctCount: true, maxStreak: true, totalQuestions: true },
    })
    const periodsAffected = beforeEntries.map((entry) => ({ periodType: entry.periodType, periodKey: entry.periodKey }))
    const before = {
      score: session.score,
      correctCount: session.correctCount,
      maxStreak: session.maxStreak,
      totalQuestions: session.totalQuestions,
    }

    // 2) 标记 source Session 不再参与排行榜（保留历史）
    await tx.wantListenSession.update({ where: { id: session.id }, data: { excludedFromLeaderboard: true } })
    // 3) 删除该 Session 产生的全部 LeaderboardEntry（跨周期）
    await tx.wantListenLeaderboardEntry.deleteMany({ where: { sessionId: session.id } })
    // 4) 从剩余合法 Session 重新聚合 DAY / WEEK / ALL（被排除 Session 因 excludedFromLeaderboard 被过滤，不会重现）
    await recomputeUserWantListenLeaderboard(input.userId, mode, tx)

    // 重新读取受影响周期的新最高成绩（供前端展示「删除后自动补位」）
    const after: Array<{ periodType: string; periodKey: string; score: number | null }> = []
    for (const period of periodsAffected) {
      const entry = await tx.wantListenLeaderboardEntry.findFirst({
        where: { userId: input.userId, mode, periodType: period.periodType, periodKey: period.periodKey },
        select: { score: true },
      })
      after.push({ periodType: period.periodType, periodKey: period.periodKey, score: entry?.score ?? null })
    }

    await tx.adminActionLog.create({
      data: {
        adminId: input.adminId,
        targetUserId: input.userId,
        action: 'WANT_LISTEN_DELETE_SCORE',
        detail: {
          gameMode: mode,
          targetUserId: input.userId,
          operatorId: input.adminId,
          userId: input.userId,
          uid: session.User.uid,
          nickname: getPublicUserDisplayName(session.User),
          mode,
          score: before.score,
          correctCount: before.correctCount,
          completedCount: before.totalQuestions,
          maxStreak: before.maxStreak,
          sessionId: session.id,
          achievedAt: session.completedAt?.toISOString() ?? null,
          periodsAffected,
          after,
          reason,
          deletedAt: new Date().toISOString(),
        },
      },
    })

    return {
      deletedSessionId: session.id,
      mode,
      before,
      periodsAffected,
      after,
      targetUserId: input.userId,
      uid: session.User.uid,
      nickname: getPublicUserDisplayName(session.User),
      reason,
    }
  })
}
