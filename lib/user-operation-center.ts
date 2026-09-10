import type { Prisma } from '@prisma/client'
import { getShanghaiDayRange } from '@/lib/checkin'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { GUESS_SONG_RISK_THRESHOLD } from '@/lib/guess-song-constants'

export const USER_OPERATION_CATEGORIES = [
  'ALL',
  'ACCOUNT',
  'CHECKIN',
  'CONTENT',
  'SOCIAL',
  'GAME',
  'ANGEL_GIFT',
  'REWARD',
  'BADGE',
  'ACTIVITY',
  'RISK',
  'ADMIN',
] as const

export type UserOperationCategory = (typeof USER_OPERATION_CATEGORIES)[number]
export type UserOperationView = 'today' | 'risk' | 'timeline' | 'users'

export const userOperationCategoryLabels: Record<UserOperationCategory, string> = {
  ALL: '全部',
  ACCOUNT: '账号 / 资料',
  CHECKIN: '挂号 / 补签',
  CONTENT: '内容',
  SOCIAL: '好友 / 社交',
  GAME: '娱乐天空',
  ANGEL_GIFT: '天使的礼物',
  REWARD: '奖励 / 积分',
  BADGE: '勋章',
  ACTIVITY: '活动',
  RISK: '风险',
  ADMIN: '管理员操作',
}

export type UserOperationUser = {
  id: string
  uid: number
  nickname: string
  username: string
  email: string | null
  phone: string | null
  avatarUrl: string | null
  status: string
  role: string
  createdAt: string
  lastActiveAt: string | null
}

export type UserOperationOperator = {
  type: string
  userId: string | null
  uid: number | null
  nickname: string | null
}

export type UserOperationEvent = {
  id: string
  userId: string
  category: Exclude<UserOperationCategory, 'ALL'>
  action: string
  summary: string
  source: string
  occurredAt: string
  detail: Record<string, string | number | boolean | null>
  operator: UserOperationOperator | null
  target: { type: string; id: string; title: string | null } | null
  riskLevel: string | null
  audit?: { themeId: string; drawId?: string; combineId?: string }
  user?: UserOperationUser
}

export type UserOperationPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

export type UserOperationAngelGiftTheme = {
  id: string
  title: string
  drawCount: number
}

export type UserOperationAngelGiftSummary = {
  totalDrawCount: number
  themeCount: number
  totalCost: number
  firstDrawAt: string | null
  lastDrawAt: string | null
  totalRecordCount: number
  combineCount: number
  selectedThemeId: string | null
  themes: UserOperationAngelGiftTheme[]
}

function emptyAngelGiftSummary(selectedThemeId: string | null = null): UserOperationAngelGiftSummary {
  return { totalDrawCount: 0, themeCount: 0, totalCost: 0, firstDrawAt: null, lastDrawAt: null, totalRecordCount: 0, combineCount: 0, selectedThemeId, themes: [] }
}

export type UserOperationRiskUser = {
  user: UserOperationUser
  riskLevel: string
  reasons: string[]
  latestRiskAt: string
  eventCount: number
}

const EVENT_PAGE_LIMIT = 50
const SOURCE_MAX_TAKE = 500

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function displayValue(value: unknown): string | number | boolean | null {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value ?? null
  return JSON.stringify(value).slice(0, 500)
}

function detailOf(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, displayValue(value)])) as UserOperationEvent['detail']
}

function event(input: Omit<UserOperationEvent, 'occurredAt'> & { occurredAt: Date }) {
  return { ...input, occurredAt: input.occurredAt.toISOString() }
}

function categoryEnabled(category: UserOperationCategory, filter: UserOperationCategory) {
  return filter === 'ALL' || category === filter
}

function normalizePage(value: string | number | null | undefined, fallback: number, max = 10_000) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, max) : fallback
}

export function normalizeUserOperationCategory(value: string | null | undefined): UserOperationCategory {
  return USER_OPERATION_CATEGORIES.includes(value as UserOperationCategory) ? value as UserOperationCategory : 'ALL'
}

function safeQuery<T>(label: string, query: Promise<T>, fallback: T) {
  return query.catch((error) => {
    // A not-yet-applied additive migration should not take down the rest of
    // the read-only admin audit page. The deployment preflight still validates
    // that the migration is required before release.
    console.error(`[user-operation-center.${label}]`, error instanceof Error ? error.message : error)
    return fallback
  })
}

function dateRange(from: Date, to: Date) {
  return { gte: from, lte: to }
}

function withinRange(value: Date, options: { from: Date; to: Date }) {
  return value >= options.from && value <= options.to
}

function scopeFor(field: string, scope: { userId?: string; userIds?: string[] }) {
  if (scope.userId) return { [field]: scope.userId }
  if (scope.userIds) return { [field]: { in: scope.userIds } }
  return {}
}

function userCard(row: {
  id: string
  uid: number
  nickname: string
  username: string
  email: string | null
  phone: string | null
  avatarUrl: string | null
  status: string
  role: string
  createdAt: Date
  lastActiveAt: Date | null
  Profile?: { displayName: string; avatarUrl: string | null } | null
}): UserOperationUser {
  return {
    id: row.id,
    uid: row.uid,
    nickname: row.nickname || row.Profile?.displayName || 'E院用户',
    username: row.username,
    email: row.email,
    phone: row.phone,
    avatarUrl: publicImageUrl(row.Profile?.avatarUrl || row.avatarUrl),
    status: row.status,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    lastActiveAt: row.lastActiveAt?.toISOString() || null,
  }
}

const userSelect = {
  id: true,
  uid: true,
  nickname: true,
  username: true,
  email: true,
  phone: true,
  avatarUrl: true,
  status: true,
  role: true,
  createdAt: true,
  lastActiveAt: true,
  Profile: { select: { displayName: true, avatarUrl: true } },
} satisfies Prisma.UserSelect

async function loadUsersByIds(ids: string[]) {
  if (!ids.length) return new Map<string, UserOperationUser>()
  const rows = await safeQuery('users', prisma.user.findMany({ where: { id: { in: ids } }, select: userSelect }), [])
  return new Map(rows.map((row) => [row.id, userCard(row)]))
}

export async function searchUserOperationUsers(query: string, limit = 20) {
  const keyword = query.trim().slice(0, 80)
  if (!keyword) return []
  const numericUid = Number(keyword)
  const where: Prisma.UserWhereInput = {
    isDeleted: false,
    OR: [
      ...(Number.isSafeInteger(numericUid) && numericUid > 0 ? [{ uid: numericUid }] : []),
      { nickname: { contains: keyword } },
      { username: { contains: keyword } },
      { email: { contains: keyword } },
      { phone: { contains: keyword } },
      { Profile: { displayName: { contains: keyword } } },
    ],
  }
  const rows = await prisma.user.findMany({ where, orderBy: { uid: 'asc' }, take: Math.min(50, Math.max(1, limit)), select: userSelect })
  return rows.map(userCard)
}

type OperationScope = { userId?: string; userIds?: string[] }
type OperationLoadOptions = OperationScope & {
  from: Date
  to: Date
  category: UserOperationCategory
  take: number
  themeId?: string | null
}

function operator(type: string, userId: string | null = null, row?: { uid?: number | null; nickname?: string | null } | null): UserOperationOperator {
  return { type, userId, uid: row?.uid ?? null, nickname: row?.nickname ?? null }
}

function target(type: string | null | undefined, id: string | null | undefined, title: string | null = null) {
  return type && id ? { type, id, title } : null
}

async function loadPersistedProfileEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('ACCOUNT', options.category)) return []
  const rows = await safeQuery('user-operation-log', prisma.userOperationLog.findMany({
    where: {
      ...scopeFor('userId', options),
      ...(options.category !== 'ALL' ? { category: options.category } : {}),
      occurredAt: dateRange(options.from, options.to),
    },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: options.take,
    select: {
      id: true,
      userId: true,
      category: true,
      action: true,
      summary: true,
      metadata: true,
      source: true,
      operatorType: true,
      operatorUserId: true,
      targetType: true,
      targetId: true,
      riskLevel: true,
      occurredAt: true,
      operator: { select: { uid: true, nickname: true } },
    },
  }), [])

  return rows.map((row) => {
    const metadata = recordValue(row.metadata)
    const userId = row.userId
    return event({
      id: `USER_OPERATION_LOG:${row.id}`,
      userId,
      category: (row.category as Exclude<UserOperationCategory, 'ALL'>) || 'ACCOUNT',
      action: row.action,
      summary: row.summary,
      source: row.source,
      detail: detailOf(metadata),
      operator: operator(row.operatorType, row.operatorUserId, row.operator),
      target: target(row.targetType, row.targetId),
      riskLevel: row.riskLevel,
      occurredAt: row.occurredAt,
    })
  })
}

async function loadAdminEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('ADMIN', options.category)) return []
  const targetScope = options.userId
    ? { targetUserId: options.userId }
    : options.userIds
      ? { targetUserId: { in: options.userIds } }
      : { targetUserId: { not: null } }
  const logScope = scopeFor('targetUserId', options)
  const [actions, logs] = await Promise.all([
    safeQuery('admin-action', prisma.adminAction.findMany({
      where: { ...targetScope, createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.take,
      select: {
        id: true,
        action: true,
        reason: true,
        createdAt: true,
        adminId: true,
        operatorName: true,
        operatorUid: true,
        operationType: true,
        targetType: true,
        targetId: true,
        targetTitle: true,
        targetUserId: true,
        User_AdminAction_adminIdToUser: { select: { uid: true, nickname: true } },
      },
    }), []),
    safeQuery('admin-action-log', prisma.adminActionLog.findMany({
      where: { ...logScope, createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.take,
      select: {
        id: true,
        action: true,
        targetUserId: true,
        detail: true,
        createdAt: true,
        adminId: true,
        User_AdminActionLog_adminIdToUser: { select: { uid: true, nickname: true } },
      },
    }), []),
  ])

  const actionEvents = actions.filter((row) => row.targetUserId).map((row) => event({
    id: `ADMIN_ACTION:${row.id}`,
    userId: row.targetUserId!,
    category: 'ADMIN',
    action: row.operationType || row.action,
    summary: row.reason || row.operationType || row.action,
    source: 'AdminAction',
    detail: detailOf({ result: 'SUCCESS', targetType: row.targetType, targetId: row.targetId, targetTitle: row.targetTitle }),
    operator: operator('ADMIN', row.adminId, row.User_AdminAction_adminIdToUser || { uid: row.operatorUid, nickname: row.operatorName }),
    target: target(row.targetType || 'USER', row.targetId || row.targetUserId, row.targetTitle),
    riskLevel: null,
    occurredAt: row.createdAt,
  }))
  const logEvents = logs.map((row) => {
    const detail = recordValue(row.detail)
    const isProfileChange = row.action === 'UPDATE_USER_PROFILE'
    return event({
      id: `ADMIN_ACTION_LOG:${row.id}`,
      userId: row.targetUserId,
      category: isProfileChange ? 'ACCOUNT' : 'ADMIN',
      action: row.action,
      summary: isProfileChange ? '管理员修改资料' : row.action,
      source: 'AdminActionLog',
      detail: detailOf({
        reason: detail.reason,
        targetDate: detail.targetDate || detail.targetDateKey,
        changedFields: Array.isArray(detail.changedFields) ? detail.changedFields.join('、') : detail.changedFields,
        oldValue: detail.oldValue,
        newValue: detail.newValue,
      }),
      operator: operator('ADMIN', row.adminId, row.User_AdminActionLog_adminIdToUser),
      target: target('USER', row.targetUserId),
      riskLevel: null,
      occurredAt: row.createdAt,
    })
  })
  return [...actionEvents, ...logEvents]
}

async function loadAccountEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('ACCOUNT', options.category)) return []
  const rows = await safeQuery('account-users', prisma.user.findMany({
    where: { ...scopeFor('id', options), createdAt: dateRange(options.from, options.to) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.take,
    select: { id: true, createdAt: true },
  }), [])
  return rows.map((row) => event({
    id: `USER_REGISTERED:${row.id}`,
    userId: row.id,
    category: 'ACCOUNT',
    action: 'USER_REGISTERED',
    summary: '注册账号',
    source: 'User',
    detail: detailOf({}),
    operator: operator('SYSTEM'),
    target: target('USER', row.id),
    riskLevel: null,
    occurredAt: row.createdAt,
  }))
}

function checkInTypeLabel(type: string) {
  const labels: Record<string, string> = {
    NORMAL: '每日挂号',
    MAKEUP_FREE_QUIZ: '免费答题补签',
    MAKEUP_PAID: '付费补签',
    MAKEUP_ADMIN: '管理员补签',
  }
  return labels[type] || type
}

async function loadCheckInEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('CHECKIN', options.category)) return []
  const rows = await safeQuery('check-in', prisma.checkIn.findMany({
    where: {
      ...scopeFor('userId', options),
      OR: [
        { createdAt: dateRange(options.from, options.to) },
        { madeUpAt: dateRange(options.from, options.to) },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.take,
    select: {
      id: true,
      userId: true,
      checkinDateKey: true,
      type: true,
      madeUpAt: true,
      makeupCost: true,
      createdAt: true,
      MakeupChallenge: { select: { id: true, status: true, targetDateKey: true, selectedOptionId: true, answeredAt: true } },
    },
  }), [])
  return rows.flatMap((row) => {
    const isMakeup = row.type !== 'NORMAL'
    const occurredAt = isMakeup ? (row.madeUpAt || row.createdAt) : row.createdAt
    if (!withinRange(occurredAt, options)) return []
    return [event({
      id: `CHECK_IN:${row.id}`,
      userId: row.userId,
      category: 'CHECKIN',
      action: row.type,
      summary: isMakeup ? checkInTypeLabel(row.type) : '每日挂号',
      source: 'CheckIn',
      detail: detailOf({
        checkinDate: row.checkinDateKey,
        madeUpAt: row.madeUpAt?.toISOString() || null,
        makeupCost: row.makeupCost,
        challengeId: row.MakeupChallenge?.id || null,
        challengeStatus: row.MakeupChallenge?.status || null,
        answeredAt: row.MakeupChallenge?.answeredAt?.toISOString() || null,
      }),
      operator: operator(isMakeup && row.type === 'MAKEUP_ADMIN' ? 'ADMIN' : 'SYSTEM'),
      target: target('CHECK_IN', row.id, row.checkinDateKey),
      riskLevel: null,
      occurredAt,
    })]
  })
}

const angelGiftPointLogSelect = {
  id: true,
  action: true,
  points: true,
  before: true,
  after: true,
  businessKey: true,
  createdAt: true,
} as const

const angelGiftDrawSelect = {
  id: true,
  userId: true,
  campaignId: true,
  drawAt: true,
  campaignTitle: true,
  drawCost: true,
  prizeType: true,
  prizeName: true,
  badgeName: true,
  rewardAmount: true,
  resultType: true,
  isNewBadge: true,
  isDuplicate: true,
  duplicateQuantity: true,
  balanceBefore: true,
  balanceAfter: true,
  PointLogs: { select: angelGiftPointLogSelect },
} as const

const angelGiftRecycleSelect = {
  id: true,
  userId: true,
  campaignId: true,
  createdAt: true,
  campaignTitle: true,
  requiredCount: true,
  rewardAmount: true,
  beforeQuantity: true,
  afterQuantity: true,
  balanceBefore: true,
  balanceAfter: true,
  PointLogs: { select: angelGiftPointLogSelect },
} as const

function angelGiftDrawWhere(options: OperationLoadOptions, includeTheme = true): Prisma.PharmacyDrawWhereInput {
  return {
    ...scopeFor('userId', options),
    drawAt: dateRange(options.from, options.to),
    ...(includeTheme && options.themeId ? { campaignId: options.themeId } : {}),
  }
}

function angelGiftRecycleWhere(options: OperationLoadOptions): Prisma.PharmacyRecycleLogWhereInput {
  return {
    ...scopeFor('userId', options),
    createdAt: dateRange(options.from, options.to),
    ...(options.themeId ? { campaignId: options.themeId } : {}),
  }
}

const angelGiftPrizeTypeLabels: Record<string, string> = {
  BADGE: '勋章',
  POINTS: '挂号费',
  EMPTY: '未中奖',
  ITEM: '道具',
  COUPON: '优惠券',
  CUSTOM: '其他',
}

function angelGiftPrizeTypeLabel(value: string) {
  return angelGiftPrizeTypeLabels[value] || '其他'
}

function angelGiftDrawResultLabel(row: {
  prizeType: string
  prizeName: string
  badgeName: string | null
  rewardAmount: number | null
}) {
  if (row.prizeType === 'POINTS') return `+${row.rewardAmount || 0} 挂号费`
  return row.badgeName || row.prizeName || '未知奖品'
}

async function loadAngelGiftEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('ANGEL_GIFT', options.category)) return []
  const [draws, recycles] = await Promise.all([
    safeQuery('angel-gift-draws', prisma.pharmacyDraw.findMany({
      where: angelGiftDrawWhere(options),
      orderBy: [{ drawAt: 'desc' }, { id: 'desc' }],
      take: options.take,
      select: angelGiftDrawSelect,
    }), []),
    safeQuery('angel-gift-combines', prisma.pharmacyRecycleLog.findMany({
      where: angelGiftRecycleWhere(options),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: options.take,
      select: angelGiftRecycleSelect,
    }), []),
  ])

  const drawEvents = draws.map((row) => {
    const pointLogs = row.PointLogs
    const costLog = pointLogs.find((log) => String(log.action) === 'PHARMACY_DRAW_COST' && log.points === -row.drawCost)
    const rewardLog = pointLogs.find((log) => String(log.action) === 'PHARMACY_PRIZE_REWARD')
    const rewardStatus = row.prizeType === 'POINTS'
      ? rewardLog ? '已到账' : '未找到对应流水'
      : row.prizeType === 'BADGE'
        ? row.isDuplicate ? '重复，未再次发放' : '已发放'
        : '已记录'
    const actualRewardAmount = rewardLog?.points ?? row.rewardAmount ?? 0
    const result = angelGiftDrawResultLabel({ ...row, rewardAmount: actualRewardAmount })
    return event({
      id: `ANGEL_GIFT_DRAW:${row.id}`,
      userId: row.userId,
      category: 'ANGEL_GIFT',
      action: row.resultType,
      summary: `天使的礼物：抽中 ${result}`,
      source: 'PharmacyDraw',
      detail: detailOf({
        主题: row.campaignTitle,
        抽奖结果: result,
        奖品类型: angelGiftPrizeTypeLabel(row.prizeType),
        抽奖消耗: costLog?.points ?? -row.drawCost,
        抽中奖励: row.prizeType === 'POINTS' ? actualRewardAmount : null,
        重复勋章: row.isDuplicate,
        重复数量: row.isDuplicate ? row.duplicateQuantity : null,
        消费流水: costLog ? '已记账' : '未找到对应流水',
        奖励实际到账: rewardStatus,
      }),
      operator: operator('USER', row.userId),
      target: target('ANGEL_GIFT_DRAW', row.id, row.campaignTitle),
      riskLevel: null,
      audit: { themeId: row.campaignId, drawId: row.id },
      occurredAt: row.drawAt,
    })
  })

  const combineEvents = recycles.map((row) => {
    const rewardLog = row.PointLogs.find((log) => String(log.action) === 'PHARMACY_DUPLICATE_RECYCLE')
    return event({
      id: `ANGEL_GIFT_COMBINE:${row.id}`,
      userId: row.userId,
      category: 'ANGEL_GIFT',
      action: 'DUPLICATE_COMBINE',
      summary: '天使的礼物：重复勋章合成',
      source: 'PharmacyRecycleLog',
      detail: detailOf({
        主题: row.campaignTitle,
        合成内容: `${row.requiredCount} 枚重复勋章`,
        合成结果: `+${rewardLog?.points ?? row.rewardAmount} 挂号费`,
        奖品类型: '挂号费',
        奖励实际到账: rewardLog ? '已到账' : '未找到对应流水',
        合成前余量: row.beforeQuantity,
        合成后余量: row.afterQuantity,
      }),
      operator: operator('USER', row.userId),
      target: target('ANGEL_GIFT_COMBINE', row.id, row.campaignTitle),
      riskLevel: null,
      audit: { themeId: row.campaignId, combineId: row.id },
      occurredAt: row.createdAt,
    })
  })

  return [...drawEvents, ...combineEvents]
}

async function getAngelGiftSummary(options: OperationLoadOptions): Promise<UserOperationAngelGiftSummary> {
  const allDrawWhere = angelGiftDrawWhere(options, false)
  const filteredDrawWhere = angelGiftDrawWhere(options)
  const recycleWhere = angelGiftRecycleWhere(options)
  const [drawCount, costAggregate, themeGroups, firstDraw, lastDraw, combineCount] = await Promise.all([
    safeQuery('angel-gift-summary-count', prisma.pharmacyDraw.count({ where: filteredDrawWhere }), 0),
    safeQuery('angel-gift-summary-cost', prisma.pharmacyDraw.aggregate({ where: filteredDrawWhere, _sum: { drawCost: true } }), { _sum: { drawCost: null } }),
    safeQuery('angel-gift-theme-groups', prisma.pharmacyDraw.groupBy({ by: ['campaignId'], where: allDrawWhere, _count: { _all: true } }), []),
    safeQuery('angel-gift-first-draw', prisma.pharmacyDraw.findFirst({ where: filteredDrawWhere, orderBy: [{ drawAt: 'asc' }, { id: 'asc' }], select: { drawAt: true } }), null),
    safeQuery('angel-gift-last-draw', prisma.pharmacyDraw.findFirst({ where: filteredDrawWhere, orderBy: [{ drawAt: 'desc' }, { id: 'desc' }], select: { drawAt: true } }), null),
    safeQuery('angel-gift-summary-combines', prisma.pharmacyRecycleLog.count({ where: recycleWhere }), 0),
  ])

  const themeIds = themeGroups.map((row) => row.campaignId)
  const titleRows = themeIds.length
    ? await safeQuery('angel-gift-theme-titles', prisma.pharmacyDraw.findMany({
      where: { ...allDrawWhere, campaignId: { in: themeIds } },
      orderBy: [{ drawAt: 'desc' }, { id: 'desc' }],
      distinct: ['campaignId'],
      select: { campaignId: true, campaignTitle: true },
    }), [])
    : []
  const titleById = new Map(titleRows.map((row) => [row.campaignId, row.campaignTitle.trim() || '未知主题']))
  const orderById = new Map(titleRows.map((row, index) => [row.campaignId, index]))
  const themes = themeGroups
    .map((row) => ({ id: row.campaignId, title: titleById.get(row.campaignId) || '未知主题', drawCount: row._count._all }))
    .sort((left, right) => (orderById.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderById.get(right.id) ?? Number.MAX_SAFE_INTEGER) || left.title.localeCompare(right.title, 'zh-CN'))

  return {
    totalDrawCount: drawCount,
    themeCount: options.themeId ? (drawCount || combineCount ? 1 : 0) : themes.length,
    totalCost: costAggregate._sum.drawCost || 0,
    firstDrawAt: firstDraw?.drawAt.toISOString() || null,
    lastDrawAt: lastDraw?.drawAt.toISOString() || null,
    totalRecordCount: drawCount + combineCount,
    combineCount,
    selectedThemeId: options.themeId || null,
    themes,
  }
}

async function loadPointEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('REWARD', options.category)) return []
  const rows = await safeQuery('point-log', prisma.pointLog.findMany({
    // Angel Gift draws and duplicate-combine records are represented by their
    // own audit events below. Keeping their ledger rows out of the generic
    // reward category avoids showing the same business action twice while the
    // Angel Gift event still cross-references the actual PointLog rows.
    where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to), pharmacyDrawId: null, pharmacyRecycleLogId: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.take,
    select: { id: true, userId: true, action: true, points: true, before: true, after: true, reason: true, createdAt: true, businessKey: true, growthTaskCode: true },
  }), [])
  return rows.map((row) => event({
    id: `POINT_LOG:${row.id}`,
    userId: row.userId,
    category: 'REWARD',
    action: String(row.action),
    summary: row.reason || `挂号费变动 ${row.points >= 0 ? '+' : ''}${row.points}`,
    source: 'PointLog',
    detail: detailOf({ points: row.points, before: row.before, after: row.after, businessKey: row.businessKey, growthTaskCode: row.growthTaskCode }),
    operator: operator('SYSTEM'),
    target: null,
    riskLevel: null,
    occurredAt: row.createdAt,
  }))
}

async function loadContentEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('CONTENT', options.category)) return []
  const [posts, replies, likes, favorites, replyLikes, moderation, salonPosts, studioProjects] = await Promise.all([
    safeQuery('posts', prisma.post.findMany({
      where: { ...scopeFor('authorId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, authorId: true, title: true, createdAt: true, status: true, moderationStatus: true },
    }), []),
    safeQuery('replies', prisma.reply.findMany({
      where: { ...scopeFor('authorId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, authorId: true, postId: true, content: true, createdAt: true, Post: { select: { title: true } } },
    }), []),
    safeQuery('likes', prisma.like.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, postId: true, createdAt: true, Post: { select: { title: true } } },
    }), []),
    safeQuery('post-favorites', prisma.postFavorite.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, postId: true, createdAt: true, Post: { select: { title: true } } },
    }), []),
    safeQuery('reply-likes', prisma.replyLike.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, replyId: true, createdAt: true, Reply: { select: { postId: true, Post: { select: { title: true } } } } },
    }), []),
    safeQuery('post-moderation-history', prisma.postModerationHistory.findMany({
      where: {
        createdAt: dateRange(options.from, options.to),
        ...(options.userId || options.userIds ? { Post: scopeFor('authorId', options) } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, postId: true, action: true, status: true, titleSnapshot: true, rejectionReason: true, createdAt: true, Post: { select: { authorId: true, title: true } }, Actor: { select: { id: true, uid: true, nickname: true } } },
    }), []),
    safeQuery('salon-posts', prisma.salonPost.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, title: true, status: true, createdAt: true, approvedAt: true },
    }), []),
    safeQuery('studio-projects', prisma.studioProject.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, title: true, toolSlug: true, reviewStatus: true, createdAt: true },
    }), []),
  ])

  return [
    ...posts.map((row) => event({
      id: `POST:${row.id}`, userId: row.authorId, category: 'CONTENT', action: 'POST_CREATED', summary: '发布帖子', source: 'Post',
      detail: detailOf({ status: row.status, moderationStatus: row.moderationStatus }), operator: operator('USER', row.authorId), target: target('POST', row.id, row.title), riskLevel: null, occurredAt: row.createdAt,
    })),
    ...replies.map((row) => event({
      id: `REPLY:${row.id}`, userId: row.authorId, category: 'CONTENT', action: 'REPLY_CREATED', summary: '回复帖子', source: 'Reply',
      detail: detailOf({ content: row.content.slice(0, 160), postId: row.postId }), operator: operator('USER', row.authorId), target: target('POST', row.postId, row.Post.title), riskLevel: null, occurredAt: row.createdAt,
    })),
    ...likes.map((row) => event({
      id: `LIKE:${row.id}`, userId: row.userId, category: 'CONTENT', action: 'POST_LIKED', summary: '点赞帖子', source: 'Like', detail: detailOf({ postId: row.postId }), operator: operator('USER', row.userId), target: target('POST', row.postId, row.Post.title), riskLevel: null, occurredAt: row.createdAt,
    })),
    ...favorites.map((row) => event({
      id: `POST_FAVORITE:${row.id}`, userId: row.userId, category: 'CONTENT', action: 'POST_FAVORITED', summary: '收藏帖子', source: 'PostFavorite', detail: detailOf({ postId: row.postId }), operator: operator('USER', row.userId), target: target('POST', row.postId, row.Post.title), riskLevel: null, occurredAt: row.createdAt,
    })),
    ...replyLikes.map((row) => event({
      id: `REPLY_LIKE:${row.id}`, userId: row.userId, category: 'CONTENT', action: 'REPLY_LIKED', summary: '点赞回复', source: 'ReplyLike', detail: detailOf({ replyId: row.replyId, postId: row.Reply.postId }), operator: operator('USER', row.userId), target: target('POST', row.Reply.postId, row.Reply.Post.title), riskLevel: null, occurredAt: row.createdAt,
    })),
    ...moderation.flatMap((row) => row.Post?.authorId ? [event({
      id: `POST_MODERATION:${row.id}`, userId: row.Post.authorId, category: 'CONTENT', action: `POST_MODERATION_${row.action}`, summary: `帖子审核：${row.action}`, source: 'PostModerationHistory',
      detail: detailOf({ status: row.status, rejectionReason: row.rejectionReason }), operator: operator('ADMIN', row.Actor?.id || null, row.Actor), target: target('POST', row.postId, row.titleSnapshot || row.Post?.title || null), riskLevel: null, occurredAt: row.createdAt,
    })] : []),
    ...salonPosts.map((row) => event({
      id: `SALON_POST:${row.id}`, userId: row.userId, category: 'CONTENT', action: 'SALON_SUBMISSION', summary: '沙龙投稿', source: 'SalonPost', detail: detailOf({ status: row.status, approvedAt: row.approvedAt?.toISOString() || null }), operator: operator('USER', row.userId), target: target('SALON_POST', row.id, row.title), riskLevel: null, occurredAt: row.createdAt,
    })),
    ...studioProjects.map((row) => event({
      id: `STUDIO_PROJECT:${row.id}`, userId: row.userId, category: 'CONTENT', action: 'STUDIO_PROJECT_CREATED', summary: '创作平台投稿', source: 'StudioProject', detail: detailOf({ tool: row.toolSlug, reviewStatus: row.reviewStatus }), operator: operator('USER', row.userId), target: target('STUDIO_PROJECT', row.id, row.title), riskLevel: null, occurredAt: row.createdAt,
    })),
  ]
}

async function loadSocialEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('SOCIAL', options.category)) return []
  const [requests, messages] = await Promise.all([
    safeQuery('friend-requests', prisma.friendRequest.findMany({
      where: { createdAt: dateRange(options.from, options.to), OR: [scopeFor('senderId', options), scopeFor('receiverId', options)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, senderId: true, receiverId: true, status: true, createdAt: true },
    }), []),
    safeQuery('direct-messages', prisma.directMessage.findMany({
      where: { ...scopeFor('senderId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, senderId: true, type: true, createdAt: true },
    }), []),
  ])
  return [
    ...requests.flatMap((row) => {
      const userId = options.userId
        ? row.senderId === options.userId ? row.senderId : row.receiverId
        : options.userIds?.includes(row.senderId) ? row.senderId : row.receiverId
      return [event({
        id: `FRIEND_REQUEST:${row.id}`, userId, category: 'SOCIAL', action: `FRIEND_REQUEST_${row.status}`, summary: '好友关系变化', source: 'FriendRequest', detail: detailOf({ senderId: row.senderId, receiverId: row.receiverId, status: row.status }), operator: operator('USER', userId), target: target('USER', userId), riskLevel: null, occurredAt: row.createdAt,
      })]
    }),
    ...messages.map((row) => event({
      id: `DIRECT_MESSAGE:${row.id}`, userId: row.senderId, category: 'SOCIAL', action: 'DIRECT_MESSAGE_SENT', summary: '发送私信（仅记录事件）', source: 'DirectMessage', detail: detailOf({ type: row.type }), operator: operator('USER', row.senderId), target: null, riskLevel: null, occurredAt: row.createdAt,
    })),
  ]
}

async function loadActivityEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('ACTIVITY', options.category)) return []
  const rows = await safeQuery('activity-registrations', prisma.activityRegistration.findMany({
    where: {
      ...scopeFor('userId', options),
      OR: [
        { registeredAt: dateRange(options.from, options.to) },
        { cancelledAt: dateRange(options.from, options.to) },
        { verifiedAt: dateRange(options.from, options.to) },
        { checkedInAt: dateRange(options.from, options.to) },
      ],
    },
    orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }], take: options.take,
    select: { id: true, userId: true, activityId: true, status: true, registeredAt: true, cancelledAt: true, verifiedAt: true, checkedInAt: true, verificationMethod: true, Activity: { select: { title: true } }, VerifiedBy: { select: { id: true, uid: true, nickname: true } } },
  }), [])
  return rows.flatMap((row) => {
    const result: UserOperationEvent[] = []
    if (withinRange(row.registeredAt, options)) result.push(event({
      id: `ACTIVITY_REGISTRATION:${row.id}:registered`, userId: row.userId, category: 'ACTIVITY', action: 'ACTIVITY_REGISTERED', summary: '活动报名', source: 'ActivityRegistration',
      detail: detailOf({ status: row.status, registrationId: row.id, paidStatus: row.status }), operator: operator('USER', row.userId), target: target('ACTIVITY', row.activityId, row.Activity.title), riskLevel: null, occurredAt: row.registeredAt,
    }))
    if (row.verifiedAt && row.verifiedAt >= options.from && row.verifiedAt <= options.to) result.push(event({
      id: `ACTIVITY_REGISTRATION:${row.id}:verified`, userId: row.userId, category: 'ACTIVITY', action: 'ACTIVITY_VERIFIED', summary: '活动报名已核销', source: 'ActivityRegistration',
      detail: detailOf({ verificationMethod: row.verificationMethod, checkedInAt: row.checkedInAt?.toISOString() || null }), operator: operator('ADMIN', row.VerifiedBy?.id || null, row.VerifiedBy), target: target('ACTIVITY', row.activityId, row.Activity.title), riskLevel: null, occurredAt: row.verifiedAt,
    }))
    if (row.cancelledAt && row.cancelledAt >= options.from && row.cancelledAt <= options.to) result.push(event({
      id: `ACTIVITY_REGISTRATION:${row.id}:cancelled`, userId: row.userId, category: 'ACTIVITY', action: 'ACTIVITY_CANCELLED', summary: '取消活动报名', source: 'ActivityRegistration',
      detail: detailOf({ registrationId: row.id }), operator: operator('SYSTEM'), target: target('ACTIVITY', row.activityId, row.Activity.title), riskLevel: null, occurredAt: row.cancelledAt,
    }))
    return result
  })
}

async function loadUserRewardEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('REWARD', options.category)) return []
  const rows = await safeQuery('user-rewards', prisma.userReward.findMany({
    where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
    select: { id: true, userId: true, operatorId: true, experienceAmount: true, registrationFeeAmount: true, reason: true, createdAt: true, operator: { select: { uid: true, nickname: true } } },
  }), [])
  return rows.map((row) => event({
    id: `USER_REWARD:${row.id}`, userId: row.userId, category: 'REWARD', action: 'USER_REWARD', summary: row.reason || '管理员发放奖励', source: 'UserReward',
    detail: detailOf({ experience: row.experienceAmount, registrationFee: row.registrationFeeAmount }), operator: operator('ADMIN', row.operatorId, row.operator), target: null, riskLevel: null, occurredAt: row.createdAt,
  }))
}

async function loadBadgeEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('BADGE', options.category)) return []
  const rows = await safeQuery('badges', prisma.userBadge.findMany({
    where: {
      ...scopeFor('userId', options),
      OR: [
        { createdAt: dateRange(options.from, options.to) },
        { grantedAt: dateRange(options.from, options.to) },
        { revokedAt: dateRange(options.from, options.to) },
        { expiredAt: dateRange(options.from, options.to) },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
    select: { id: true, userId: true, badgeId: true, status: true, sourceType: true, grantReason: true, grantedAt: true, createdAt: true, revokedAt: true, expiredAt: true, grantedBy: true, Badge: { select: { name: true } }, GrantedBy: { select: { uid: true, nickname: true } } },
  }), [])
  return rows.flatMap((row) => {
    const result: UserOperationEvent[] = []
    const grantedAt = row.grantedAt || row.createdAt
    if (withinRange(grantedAt, options)) result.push(event({
      id: `USER_BADGE:${row.id}:granted`, userId: row.userId, category: 'BADGE', action: 'BADGE_GRANTED', summary: '获得勋章', source: 'UserBadge',
      detail: detailOf({ badge: row.Badge.name, sourceType: row.sourceType, grantReason: row.grantReason, status: row.status }), operator: operator(row.grantedBy ? 'ADMIN' : 'SYSTEM', row.grantedBy, row.GrantedBy), target: target('BADGE', row.badgeId, row.Badge.name), riskLevel: null, occurredAt: grantedAt,
    }))
    if (row.revokedAt && row.revokedAt >= options.from && row.revokedAt <= options.to) result.push(event({
      id: `USER_BADGE:${row.id}:revoked`, userId: row.userId, category: 'BADGE', action: 'BADGE_REVOKED', summary: '勋章被回收', source: 'UserBadge', detail: detailOf({ badge: row.Badge.name }), operator: operator('SYSTEM'), target: target('BADGE', row.badgeId, row.Badge.name), riskLevel: null, occurredAt: row.revokedAt,
    }))
    if (row.expiredAt && row.expiredAt >= options.from && row.expiredAt <= options.to) result.push(event({
      id: `USER_BADGE:${row.id}:expired`, userId: row.userId, category: 'BADGE', action: 'BADGE_EXPIRED', summary: '勋章自动失效', source: 'UserBadge', detail: detailOf({ badge: row.Badge.name }), operator: operator('SYSTEM'), target: target('BADGE', row.badgeId, row.Badge.name), riskLevel: null, occurredAt: row.expiredAt,
    }))
    return result
  })
}

function jsonSummary(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item)).join('、').slice(0, 500)
  if (value && typeof value === 'object') return JSON.stringify(value).slice(0, 500)
  return value == null ? null : String(value).slice(0, 500)
}

async function loadGameEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('GAME', options.category)) return []
  const [wantListen, guessSong, duels] = await Promise.all([
    safeQuery('want-listen-sessions', prisma.wantListenSession.findMany({
      where: {
        ...scopeFor('userId', options),
        OR: [{ createdAt: dateRange(options.from, options.to) }, { completedAt: dateRange(options.from, options.to) }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, mode: true, status: true, score: true, totalQuestions: true, correctCount: true, completedAt: true, createdAt: true, antiCheatStatus: true },
    }), []),
    safeQuery('guess-song-sessions', prisma.guessSongSession.findMany({
      where: {
        ...scopeFor('userId', options),
        OR: [{ createdAt: dateRange(options.from, options.to) }, { completedAt: dateRange(options.from, options.to) }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, mode: true, status: true, score: true, correctCount: true, questionCount: true, completedAt: true, createdAt: true, riskScore: true, isValid: true },
    }), []),
    safeQuery('guess-song-duels', prisma.guessSongDuelPlayer.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, suspicious: true, correctCount: true, createdAt: true, Match: { select: { id: true, status: true, finishedAt: true, rewardAmount: true, isSuspicious: true } } },
    }), []),
  ])
  return [
    ...wantListen.flatMap((row) => {
      const occurredAt = row.completedAt || row.createdAt
      return withinRange(occurredAt, options) ? [event({
        id: `WANT_LISTEN_SESSION:${row.id}`, userId: row.userId, category: 'GAME', action: 'WANT_LISTEN_GAME', summary: row.status === 'COMPLETED' ? '想听游戏完成' : '想听游戏记录', source: 'WantListenSession',
        detail: detailOf({ mode: row.mode, status: row.status, score: row.score, totalQuestions: row.totalQuestions, correctCount: row.correctCount, antiCheatStatus: row.antiCheatStatus }), operator: operator('USER', row.userId), target: target('GAME_SESSION', row.id, String(row.mode)), riskLevel: row.antiCheatStatus === 'SUSPICIOUS' ? 'HIGH' : null, occurredAt,
      })] : []
    }),
    ...guessSong.flatMap((row) => {
      const occurredAt = row.completedAt || row.createdAt
      return withinRange(occurredAt, options) ? [event({
        id: `GUESS_SONG_SESSION:${row.id}`, userId: row.userId, category: 'GAME', action: 'GUESS_SONG_GAME', summary: row.status === 'COMPLETED' ? '听听游戏完成' : '听听游戏记录', source: 'GuessSongSession',
        detail: detailOf({ mode: row.mode, status: row.status, score: row.score, questionCount: row.questionCount, correctCount: row.correctCount, riskScore: row.riskScore, isValid: row.isValid }), operator: operator('USER', row.userId), target: target('GAME_SESSION', row.id, String(row.mode)), riskLevel: row.riskScore >= GUESS_SONG_RISK_THRESHOLD ? 'HIGH' : null, occurredAt,
      })] : []
    }),
    ...duels.flatMap((row) => {
      const occurredAt = row.Match.finishedAt || row.createdAt
      return withinRange(occurredAt, options) ? [event({
        id: `GUESS_SONG_DUEL_PLAYER:${row.id}`, userId: row.userId, category: 'GAME', action: 'GUESS_SONG_DUEL', summary: '听听 1v1 对决', source: 'GuessSongDuelPlayer',
        detail: detailOf({ matchId: row.Match.id, status: row.Match.status, correctCount: row.correctCount, rewardAmount: row.Match.rewardAmount, suspicious: row.suspicious || row.Match.isSuspicious }), operator: operator('USER', row.userId), target: target('GAME_DUEL', row.Match.id), riskLevel: row.suspicious || row.Match.isSuspicious ? 'HIGH' : null, occurredAt,
      })] : []
    }),
  ]
}

async function loadRiskEvents(options: OperationLoadOptions) {
  if (!categoryEnabled('RISK', options.category)) return []
  const [guessRisk, antiCheat, security, wantListenSuspicious] = await Promise.all([
    safeQuery('guess-song-risk', prisma.guessSongRiskLog.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, mode: true, score: true, riskScore: true, trigger: true, reasons: true, createdAt: true, sessionId: true },
    }), []),
    safeQuery('game-anti-cheat', prisma.gameAntiCheatLog.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, gameType: true, sessionId: true, suspiciousType: true, details: true, createdAt: true },
    }), []),
    safeQuery('account-security', prisma.accountSecurityLog.findMany({
      where: { ...scopeFor('userId', options), createdAt: dateRange(options.from, options.to) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, action: true, metadata: true, createdAt: true },
    }), []),
    safeQuery('want-listen-suspicious', prisma.wantListenSession.findMany({
      where: { ...scopeFor('userId', options), antiCheatStatus: 'SUSPICIOUS', OR: [{ createdAt: dateRange(options.from, options.to) }, { completedAt: dateRange(options.from, options.to) }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: options.take,
      select: { id: true, userId: true, mode: true, antiCheatStatus: true, antiCheatReasons: true, createdAt: true, completedAt: true },
    }), []),
  ])
  return [
    ...guessRisk.map((row) => event({
      id: `GUESS_SONG_RISK:${row.id}`, userId: row.userId, category: 'RISK', action: 'GUESS_SONG_RISK', summary: '听听风控事件', source: 'GuessSongRiskLog',
      detail: detailOf({ mode: row.mode, score: row.score, riskScore: row.riskScore, trigger: row.trigger, reasons: jsonSummary(row.reasons), sessionId: row.sessionId }), operator: operator('SYSTEM'), target: target('GAME_SESSION', row.sessionId), riskLevel: row.riskScore >= GUESS_SONG_RISK_THRESHOLD ? 'HIGH' : 'MEDIUM', occurredAt: row.createdAt,
    })),
    ...antiCheat.map((row) => event({
      id: `GAME_ANTI_CHEAT:${row.id}`, userId: row.userId, category: 'RISK', action: 'GAME_ANTI_CHEAT', summary: '游戏反作弊风险', source: 'GameAntiCheatLog',
      detail: detailOf({ gameType: row.gameType, suspiciousType: row.suspiciousType, details: jsonSummary(row.details), sessionId: row.sessionId }), operator: operator('SYSTEM'), target: target('GAME_SESSION', row.sessionId), riskLevel: 'HIGH', occurredAt: row.createdAt,
    })),
    ...security.map((row) => event({
      id: `ACCOUNT_SECURITY:${row.id}`, userId: row.userId, category: 'RISK', action: row.action, summary: '账号安全风险', source: 'AccountSecurityLog', detail: detailOf({ action: row.action }), operator: operator('SYSTEM'), target: target('USER', row.userId), riskLevel: 'MEDIUM', occurredAt: row.createdAt,
    })),
    ...wantListenSuspicious.flatMap((row) => {
      const occurredAt = row.completedAt || row.createdAt
      return withinRange(occurredAt, options) ? [event({
        id: `WANT_LISTEN_RISK:${row.id}`, userId: row.userId, category: 'RISK', action: 'WANT_LISTEN_ANTI_CHEAT', summary: '想听反作弊风险', source: 'WantListenSession', detail: detailOf({ mode: row.mode, reasons: jsonSummary(row.antiCheatReasons), sessionId: row.id }), operator: operator('SYSTEM'), target: target('GAME_SESSION', row.id), riskLevel: 'HIGH', occurredAt,
      })] : []
    }),
  ]
}

function compareEvents(left: UserOperationEvent, right: UserOperationEvent) {
  const time = right.occurredAt.localeCompare(left.occurredAt)
  return time || right.id.localeCompare(left.id)
}

async function loadOperationEvents(options: OperationLoadOptions) {
  const loaders = [
    loadAccountEvents(options),
    loadPersistedProfileEvents(options),
    loadAdminEvents(options),
    loadCheckInEvents(options),
    loadPointEvents(options),
    loadContentEvents(options),
    loadSocialEvents(options),
    loadActivityEvents(options),
    loadUserRewardEvents(options),
    loadBadgeEvents(options),
    loadGameEvents(options),
    loadAngelGiftEvents(options),
    loadRiskEvents(options),
  ]
  const sourceRows = await Promise.all(loaders)
  const events = sourceRows.flat().sort(compareEvents)
  return { events, sourceHasMore: sourceRows.some((rows) => rows.length >= options.take) }
}

async function attachEventUsers(events: UserOperationEvent[]) {
  const users = await loadUsersByIds([...new Set(events.map((item) => item.userId))])
  return events.map((item) => ({ ...item, user: users.get(item.userId) })).filter((item) => item.user)
}

function paginateEvents(events: UserOperationEvent[], page: number, pageSize: number, sourceHasMore: boolean, totalOverride?: number) {
  const start = (page - 1) * pageSize
  const pageItems = events.slice(start, start + pageSize)
  const total = totalOverride ?? events.length
  const hasMore = sourceHasMore || start + pageSize < total
  return {
    events: pageItems,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore,
    } satisfies UserOperationPagination,
  }
}

export async function getTodayUserOperations(input: {
  query?: string
  category?: UserOperationCategory
  themeId?: string | null
  page?: number
  pageSize?: number
  now?: Date
}) {
  const now = input.now || new Date()
  const { start } = getShanghaiDayRange(now)
  const page = normalizePage(input.page, 1)
  const pageSize = Math.min(EVENT_PAGE_LIMIT, normalizePage(input.pageSize, 30, EVENT_PAGE_LIMIT))
  const category = input.category || 'ALL'
  let userIds: string[] | undefined
  if (input.query?.trim()) {
    userIds = (await searchUserOperationUsers(input.query, 100)).map((user) => user.id)
    if (!userIds.length) {
      return {
        events: [],
        pagination: { page, pageSize, total: 0, totalPages: 1, hasMore: false } satisfies UserOperationPagination,
        dateKey: getShanghaiDayRange(now).dateKey,
        ...(category === 'ANGEL_GIFT' ? { angelGift: emptyAngelGiftSummary(input.themeId || null) } : {}),
      }
    }
  }
  const options = { from: start, to: now, category, userIds, themeId: input.themeId || null, take: Math.min(SOURCE_MAX_TAKE, page * pageSize + 1) }
  const [loaded, angelGift] = await Promise.all([
    loadOperationEvents(options),
    category === 'ANGEL_GIFT' ? getAngelGiftSummary(options) : Promise.resolve(null),
  ])
  const paged = paginateEvents(await attachEventUsers(loaded.events), page, pageSize, loaded.sourceHasMore, angelGift?.totalRecordCount)
  return { ...paged, dateKey: getShanghaiDayRange(now).dateKey, ...(angelGift ? { angelGift } : {}) }
}

export async function getUserOperationTimeline(input: {
  userId: string
  category?: UserOperationCategory
  themeId?: string | null
  days?: number
  page?: number
  pageSize?: number
  now?: Date
}) {
  const now = input.now || new Date()
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: userSelect })
  if (!user) return null
  const page = normalizePage(input.page, 1)
  const pageSize = Math.min(EVENT_PAGE_LIMIT, normalizePage(input.pageSize, 30, EVENT_PAGE_LIMIT))
  const days = Math.min(365, Math.max(1, normalizePage(input.days, 30, 365)))
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const category = input.category || 'ALL'
  const options = { from, to: now, category, userId: input.userId, themeId: input.themeId || null, take: Math.min(SOURCE_MAX_TAKE, page * pageSize + 1) }
  const [loaded, angelGift] = await Promise.all([
    loadOperationEvents(options),
    category === 'ANGEL_GIFT' ? getAngelGiftSummary(options) : Promise.resolve(null),
  ])
  const paged = paginateEvents(await attachEventUsers(loaded.events), page, pageSize, loaded.sourceHasMore, angelGift?.totalRecordCount)
  return { user: userCard(user), days, ...paged, ...(angelGift ? { angelGift } : {}) }
}

function riskRank(value: string | null) {
  return value === 'HIGH' ? 3 : value === 'MEDIUM' ? 2 : 1
}

export async function getHighRiskUsers(input: {
  query?: string
  page?: number
  pageSize?: number
  days?: number
  now?: Date
}) {
  const now = input.now || new Date()
  const page = normalizePage(input.page, 1)
  const pageSize = Math.min(EVENT_PAGE_LIMIT, normalizePage(input.pageSize, 30, EVENT_PAGE_LIMIT))
  const days = Math.min(365, Math.max(1, normalizePage(input.days, 90, 365)))
  let userIds: string[] | undefined
  if (input.query?.trim()) {
    userIds = (await searchUserOperationUsers(input.query, 100)).map((user) => user.id)
    if (!userIds.length) return { users: [], pagination: { page, pageSize, total: 0, totalPages: 1, hasMore: false } satisfies UserOperationPagination, days }
  }
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const loaded = await loadOperationEvents({ from, to: now, category: 'RISK', userIds, take: Math.min(SOURCE_MAX_TAKE, page * pageSize + 1) })
  const withUsers = await attachEventUsers(loaded.events)
  const grouped = new Map<string, UserOperationRiskUser>()
  for (const item of withUsers) {
    if (!item.user) continue
    const current = grouped.get(item.userId)
    const reasonValue = item.detail.reasons || item.detail.trigger || item.detail.suspiciousType
    const reason = typeof reasonValue === 'string' && reasonValue ? reasonValue : item.summary
    if (!current) {
      grouped.set(item.userId, { user: item.user, riskLevel: item.riskLevel || 'MEDIUM', reasons: reason ? [reason] : [item.summary], latestRiskAt: item.occurredAt, eventCount: 1 })
      continue
    }
    current.eventCount += 1
    if (riskRank(item.riskLevel) > riskRank(current.riskLevel)) current.riskLevel = item.riskLevel || current.riskLevel
    if (reason && !current.reasons.includes(reason) && current.reasons.length < 5) current.reasons.push(reason)
    if (item.occurredAt > current.latestRiskAt) current.latestRiskAt = item.occurredAt
  }
  const users = [...grouped.values()].sort((left, right) => right.latestRiskAt.localeCompare(left.latestRiskAt) || right.user.id.localeCompare(left.user.id))
  const start = (page - 1) * pageSize
  const pageUsers = users.slice(start, start + pageSize)
  return {
    users: pageUsers,
    pagination: {
      page,
      pageSize,
      total: users.length,
      totalPages: Math.max(1, Math.ceil(users.length / pageSize)),
      hasMore: loaded.sourceHasMore || start + pageSize < users.length,
    } satisfies UserOperationPagination,
    days,
  }
}
