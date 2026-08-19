import type { Prisma, WantListenMode } from '@prisma/client'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

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
