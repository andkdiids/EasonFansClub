import type { Prisma, WantListenMode, WantListenPeriodType } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { WANT_LISTEN_MAX_WRONG_COUNT } from '@/lib/want-listen-config'
import { recordWantListenLeaderboard } from '@/lib/want-listen-leaderboard'
import { getWantListenPeriod, isWantListenScoreBetter, parseWantListenPeriod } from '@/lib/want-listen-period'

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
  const value = new Date(now)
  value.setHours(0, 0, 0, 0)
  return value
}

/** 本周一 00:00（周一为一周起点） */
export function startOfWeek(now = new Date()) {
  const value = startOfDay(now)
  const day = value.getDay() || 7
  value.setDate(value.getDate() - (day - 1))
  return value
}

type OverviewUser = {
  id: string
  uid: number
  nickname: string
  username: string
  avatarUrl: string | null
  nicknameModerationStatus: string
  usernameModerationStatus: string
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
              username: true,
              avatarUrl: true,
              nicknameModerationStatus: true,
              nicknameViolationDisplay: true,
              usernameModerationStatus: true,
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
      username: true,
      avatarUrl: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      usernameModerationStatus: true,
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
          username: true,
          avatarUrl: true,
          nicknameModerationStatus: true,
          usernameModerationStatus: true,
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

function toInteger(value: unknown, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
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
      totalQuestions: true,
      completionTimeMs: true,
      startedAt: true,
      completedAt: true,
      updatedAt: true,
      expiresAt: true,
      antiCheatStatus: true,
      User: { select: { id: true, uid: true, nickname: true, avatarUrl: true, nicknameModerationStatus: true, usernameModerationStatus: true, Profile: { select: { displayName: true, avatarUrl: true, displayNameModerationStatus: true } } } },
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

/**
 * 想听排行榜补分（复用听听补分机制：新增成绩记录 → recordWantListenLeaderboard 聚合）。
 *
 * 数据逻辑为「覆盖取最高」：
 *  - 补录成绩高于该用户当前周期成绩 → 覆盖（补 28770 覆盖原 12000 → 28770）
 *  - 补录成绩不高于现有更高成绩 → 不覆盖（已有 30000 补 28770 → 保持 30000）
 * 周期按「成绩发生时间 achievedAt」计算归属（DAY / WEEK / ALL）。
 */
export async function addWantListenAdminScore(input: {
  adminId: string
  userId: string
  mode: unknown
  period?: unknown
  score: unknown
  correctCount?: unknown
  maxStreak?: unknown
  totalQuestions?: unknown
  completionTimeMs?: unknown
  achievedAt?: unknown
  sourceSessionId?: unknown
  reason: unknown
}) {
  if (!isWantListenAdminMode(input.mode)) throw new WantListenAdminLeaderboardError('请选择有效的游戏模式')
  const mode = input.mode
  const score = Number(input.score)
  if (!Number.isInteger(score) || score <= 0 || score > 10_000_000) throw new WantListenAdminLeaderboardError('请输入有效的补分成绩')
  const reason = String(input.reason || '').trim().slice(0, 200)
  if (reason.length < 2) throw new WantListenAdminLeaderboardError('请填写补分原因')
  const achievedAt = parseAchievedAt(input.achievedAt)
  if (!achievedAt) throw new WantListenAdminLeaderboardError('成绩发生时间无效')
  const correctCount = toInteger(input.correctCount)
  const maxStreak = toInteger(input.maxStreak)
  const totalQuestions = toInteger(input.totalQuestions)
  const completionTimeMs = input.completionTimeMs === undefined || input.completionTimeMs === null || input.completionTimeMs === ''
    ? null
    : toInteger(input.completionTimeMs, 0)
  const sourceSessionId = String(input.sourceSessionId || '').trim().slice(0, 64) || null

  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true } })
    if (!target) throw new WantListenAdminLeaderboardError('用户不存在', 404, 'USER_NOT_FOUND')

    const candidate = { score, correctCount, maxStreak, totalQuestions, completionTimeMs: completionTimeMs ?? 0, achievedAt }
    const before: Array<{ periodType: WantListenPeriodType; periodKey: string; score: number }> = []
    const affected: Array<{ periodType: WantListenPeriodType; periodKey: string; score: number }> = []

    // 按成绩发生时间计算各周期归属，且只覆盖「更高成绩」
    for (const periodType of ['DAY', 'WEEK', 'ALL'] as const) {
      const period = getWantListenPeriod(periodType, achievedAt)
      const existing = await tx.wantListenLeaderboardEntry.findUnique({
        where: { userId_mode_periodType_periodKey: { userId: input.userId, mode, periodType, periodKey: period.periodKey } },
        select: { score: true, correctCount: true, maxStreak: true, totalQuestions: true, completionTimeMs: true, achievedAt: true },
      })
      if (existing) before.push({ periodType, periodKey: period.periodKey, score: existing.score })
      if (!existing || isWantListenScoreBetter(candidate, existing)) {
        affected.push({ periodType, periodKey: period.periodKey, score })
      }
    }

    if (!affected.length) {
      // 已有更高或相同成绩：不覆盖（符合「补分不覆盖更高分」）
      return { mode, before, after: [], applied: false, sourceSessionId: null, reason }
    }

    // 新增成绩记录（复用/创建补分 session）→ recordWantListenLeaderboard 聚合，不直接改 entry 表
    let resolvedSessionId = sourceSessionId
    if (resolvedSessionId) {
      const source = await tx.wantListenSession.findFirst({
        where: { id: resolvedSessionId, userId: input.userId },
        select: { id: true, completionTimeMs: true },
      })
      if (!source) throw new WantListenAdminLeaderboardError('未找到该游戏记录', 404, 'SESSION_NOT_FOUND')
      await tx.wantListenSession.update({
        where: { id: source.id },
        data: {
          score,
          correctCount,
          maxStreak,
          totalQuestions,
          completionTimeMs: completionTimeMs ?? source.completionTimeMs,
          completedAt: achievedAt,
          status: 'COMPLETED',
          activeKey: null,
        },
      })
    } else {
      const created = await tx.wantListenSession.create({
        data: {
          userId: input.userId,
          mode,
          status: 'COMPLETED',
          currentQuestion: 1,
          questionCount: null,
          score,
          correctCount,
          maxStreak,
          totalQuestions,
          wrongCount: 0,
          livesRemaining: WANT_LISTEN_MAX_WRONG_COUNT,
          startedAt: achievedAt,
          completedAt: achievedAt,
          completionTimeMs: completionTimeMs ?? null,
          expiresAt: achievedAt,
          antiCheatStatus: 'CLEAN', // 管理员补分成绩视为 CLEAN，可进排行榜
          ipAddress: 'admin-bonus',
          userAgent: 'admin-bonus',
        },
        select: { id: true },
      })
      resolvedSessionId = created.id
    }
    // recordWantListenLeaderboard 一次处理 DAY / WEEK / ALL 全部周期
    await recordWantListenLeaderboard(resolvedSessionId, tx)

    await tx.adminActionLog.create({
      data: {
        adminId: input.adminId,
        targetUserId: input.userId,
        action: 'WANT_LISTEN_ADD_SCORE',
        detail: {
          mode,
          before,
          after: affected,
          score,
          correctCount,
          maxStreak,
          totalQuestions,
          completionTimeMs,
          achievedAt: achievedAt.toISOString(),
          sourceSessionId: resolvedSessionId,
          reason,
        },
      },
    })

    return { mode, before, after: affected, applied: true, sourceSessionId: resolvedSessionId, reason }
  })
}
