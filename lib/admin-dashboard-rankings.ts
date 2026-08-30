import type { Prisma } from '@prisma/client'

import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { BEIJING_TIME_ZONE, getBeijingDateKey, shiftBeijingDateKey } from '@/lib/beijing-time'
import { parseBeijingDate } from '@/lib/checkin'
import { publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const DASHBOARD_RANKING_LIMIT = 10

export const DASHBOARD_RANKING_PERIODS = ['this_week', 'last_week', 'this_month', 'last_month', 'custom'] as const

export type DashboardPresetPeriod = typeof DASHBOARD_RANKING_PERIODS[number]

/** `week` / `month` remain accepted for old bookmarked API URLs. */
export type DashboardRankingPeriod = DashboardPresetPeriod | 'week' | 'month'

export type DashboardDateRangeInput = {
  period: DashboardRankingPeriod
  startDate?: unknown
  endDate?: unknown
  now?: Date
}

export type DashboardPeriodRange = {
  period: DashboardPresetPeriod
  start: Date
  endExclusive: Date
  /** Backward-compatible alias for callers that used the old range shape. */
  end: Date
  label: string
  startDateKey: string
  endDateKey: string
}

export type DashboardRankingEntry = {
  rank: number
  userId: string
  uid: number
  nickname: string
  avatarUrl: string | null
  displayId: string
  count: number
  period: DashboardPresetPeriod
  periodStart: Date
  periodEnd: Date
}

export type DashboardRankingsResult = {
  period: DashboardPresetPeriod
  range: DashboardPeriodRange
  postRanking: DashboardRankingEntry[]
  commentRanking: DashboardRankingEntry[]
  consultationRanking: DashboardRankingEntry[]
}

type RankingAggregate = {
  userId: string
  count: number
  lastActivityAt: Date
}

const rankingUserWhere = {
  status: 'ACTIVE',
  isDeleted: false,
  Profile: { isNot: null },
} satisfies Prisma.UserWhereInput

const rankingUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect

export function parseDashboardRankingPeriod(value: string | null | undefined): DashboardRankingPeriod | null {
  return value && (DASHBOARD_RANKING_PERIODS as readonly string[]).includes(value)
    ? value as DashboardPresetPeriod
    : value === 'week' || value === 'month'
      ? value
      : null
}

export const DASHBOARD_TIME_ZONE = BEIJING_TIME_ZONE

export class DashboardDateRangeError extends Error {
  readonly status = 400

  constructor(readonly code: 'CUSTOM_DATE_REQUIRED' | 'CUSTOM_DATE_INVALID' | 'CUSTOM_DATE_ORDER') {
    super(
      code === 'CUSTOM_DATE_ORDER'
        ? '开始日期不能晚于结束日期'
        : code === 'CUSTOM_DATE_REQUIRED'
          ? '请选择开始日期和结束日期'
          : '自定义日期无效，请重新选择日期',
    )
    this.name = 'DashboardDateRangeError'
  }
}

function dateKeyToShanghaiStart(dateKey: string) {
  const date = parseBeijingDate(dateKey)
  if (!date) throw new RangeError(`Invalid Shanghai date key: ${dateKey}`)
  return date
}

function normalizePeriod(period: DashboardRankingPeriod): DashboardPresetPeriod {
  if (period === 'week') return 'this_week'
  if (period === 'month') return 'this_month'
  return period
}

function getMondayKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const daysSinceMonday = (weekday + 6) % 7
  return shiftBeijingDateKey(dateKey, -daysSinceMonday)
}

function getMonthStartKey(dateKey: string) {
  return `${dateKey.slice(0, 7)}-01`
}

function getPreviousMonthStartKey(dateKey: string) {
  const [year, month] = dateKey.slice(0, 7).split('-').map(Number)
  const previous = new Date(Date.UTC(year, month - 2, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function normalizeDateKey(value: unknown) {
  if (typeof value !== 'string') return null
  const dateKey = value.trim()
  return parseBeijingDate(dateKey) ? dateKey : null
}

function buildDashboardRange(
  period: DashboardPresetPeriod,
  startDateKey: string,
  endDateKey: string,
  endExclusive: Date,
  label: string,
): DashboardPeriodRange {
  return {
    period,
    start: dateKeyToShanghaiStart(startDateKey),
    endExclusive,
    end: endExclusive,
    label,
    startDateKey,
    endDateKey,
  }
}

/**
 * Resolve every dashboard period in one place. Date-only custom input is
 * interpreted as a Shanghai calendar date, while `now` is always server-side.
 */
export function resolveDashboardDateRange(input: DashboardDateRangeInput): DashboardPeriodRange {
  const period = normalizePeriod(input.period)
  const now = new Date(input.now || new Date())
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid dashboard ranking date')

  if (period === 'custom') {
    const rawStartDate = typeof input.startDate === 'string' ? input.startDate.trim() : ''
    const rawEndDate = typeof input.endDate === 'string' ? input.endDate.trim() : ''
    if (!rawStartDate || !rawEndDate) throw new DashboardDateRangeError('CUSTOM_DATE_REQUIRED')
    const startDateKey = normalizeDateKey(rawStartDate)
    const endDateKey = normalizeDateKey(rawEndDate)
    if (!startDateKey || !endDateKey) throw new DashboardDateRangeError('CUSTOM_DATE_INVALID')
    if (startDateKey > endDateKey) throw new DashboardDateRangeError('CUSTOM_DATE_ORDER')
    const endExclusiveKey = shiftBeijingDateKey(endDateKey, 1)
    const endExclusive = dateKeyToShanghaiStart(endExclusiveKey)
    return buildDashboardRange(period, startDateKey, endDateKey, endExclusive, '自定义')
  }

  const dateKey = getBeijingDateKey(now)
  if (period === 'this_week') {
    return buildDashboardRange(period, getMondayKey(dateKey), dateKey, now, '本周')
  }
  if (period === 'last_week') {
    const thisWeekStartKey = getMondayKey(dateKey)
    const lastWeekStartKey = shiftBeijingDateKey(thisWeekStartKey, -7)
    return buildDashboardRange(period, lastWeekStartKey, shiftBeijingDateKey(thisWeekStartKey, -1), dateKeyToShanghaiStart(thisWeekStartKey), '上周')
  }
  if (period === 'this_month') {
    return buildDashboardRange(period, getMonthStartKey(dateKey), dateKey, now, '本月')
  }

  const thisMonthStartKey = getMonthStartKey(dateKey)
  return buildDashboardRange(period, getPreviousMonthStartKey(dateKey), shiftBeijingDateKey(thisMonthStartKey, -1), dateKeyToShanghaiStart(thisMonthStartKey), '上月')
}

/** Alias used by callers that refer to the panel as analytics. */
export function resolveAnalyticsDateRange(input: DashboardDateRangeInput) {
  return resolveDashboardDateRange(input)
}

/** Backward-compatible wrapper for the original week/month helper. */
export function getDashboardPeriodRange(period: DashboardRankingPeriod, now = new Date()): DashboardPeriodRange {
  return resolveDashboardDateRange({ period, now })
}

export function sortRankingAggregates(rows: ReadonlyArray<RankingAggregate>) {
  return [...rows]
    .sort((left, right) => (
      right.count - left.count
      || left.lastActivityAt.getTime() - right.lastActivityAt.getTime()
      || left.userId.localeCompare(right.userId)
    ))
    .slice(0, DASHBOARD_RANKING_LIMIT)
}

function publicForumPostRelationWhere(): Prisma.PostWhereInput {
  return {
    ...publicPostWhere,
    deletedAt: null,
    Board: { isActive: true },
  }
}

async function queryPostRanking(range: DashboardPeriodRange) {
  const rows = await prisma.post.groupBy({
    by: ['authorId'],
    where: {
      ...publicForumPostRelationWhere(),
      createdAt: { gte: range.start, lt: range.endExclusive },
      User: rankingUserWhere,
    },
    orderBy: [
      { _count: { id: 'desc' } },
      { _max: { createdAt: 'asc' } },
      { authorId: 'asc' },
    ],
    take: DASHBOARD_RANKING_LIMIT,
    _count: true,
    _max: { createdAt: true },
  })

  return rows.map((row) => ({
    userId: row.authorId,
    count: row._count,
    lastActivityAt: row._max.createdAt || range.end,
  }))
}

async function queryCommentRanking(range: DashboardPeriodRange) {
  const rows = await prisma.reply.groupBy({
    by: ['authorId'],
    where: {
      isDeleted: false,
      deletedAt: null,
      createdAt: { gte: range.start, lt: range.endExclusive },
      User: rankingUserWhere,
      Post: {
        ...publicForumPostRelationWhere(),
      },
    },
    orderBy: [
      { _count: { id: 'desc' } },
      { _max: { createdAt: 'asc' } },
      { authorId: 'asc' },
    ],
    take: DASHBOARD_RANKING_LIMIT,
    _count: true,
    _max: { createdAt: true },
  })

  return rows.map((row) => ({
    userId: row.authorId,
    count: row._count,
    lastActivityAt: row._max.createdAt || range.end,
  }))
}

async function queryConsultationRanking(range: DashboardPeriodRange) {
  const rows = await prisma.clinicConsultation.groupBy({
    by: ['authorId'],
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      createdAt: { gte: range.start, lt: range.endExclusive },
      author: rankingUserWhere,
      record: { status: 'ACTIVE', deletedAt: null },
    },
    orderBy: [
      { _count: { id: 'desc' } },
      { _max: { createdAt: 'asc' } },
      { authorId: 'asc' },
    ],
    take: DASHBOARD_RANKING_LIMIT,
    _count: true,
    _max: { createdAt: true },
  })

  return rows.map((row) => ({
    userId: row.authorId,
    count: row._count,
    lastActivityAt: row._max.createdAt || range.end,
  }))
}

async function loadRankingUsers(userIds: ReadonlyArray<string>) {
  if (!userIds.length) return []

  return prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] }, ...rankingUserWhere },
    select: rankingUserSelect,
  })
}

function buildRanking(
  aggregates: ReadonlyArray<RankingAggregate>,
  users: ReadonlyArray<Awaited<ReturnType<typeof loadRankingUsers>>[number]>,
  range: DashboardPeriodRange,
) {
  const userById = new Map(users.map((user) => [user.id, user]))

  return sortRankingAggregates(aggregates).flatMap((aggregate, index) => {
    const user = userById.get(aggregate.userId)
    if (!user) return []

    return [{
      rank: index + 1,
      userId: user.id,
      uid: user.uid,
      nickname: getPublicUserDisplayName(user),
      avatarUrl: publicImageUrl(user.Profile?.avatarUrl) || publicImageUrl(user.avatarUrl),
      displayId: formatUid(user.uid),
      count: aggregate.count,
      period: range.period,
      periodStart: range.start,
      periodEnd: range.endExclusive,
    }]
  })
}

export async function getPostRanking(period: DashboardRankingPeriod, now = new Date()) {
  const range = resolveDashboardDateRange({ period, now })
  const aggregates = await queryPostRanking(range)
  const users = await loadRankingUsers(aggregates.map((item) => item.userId))
  return buildRanking(aggregates, users, range)
}

export async function getCommentRanking(period: DashboardRankingPeriod, now = new Date()) {
  const range = resolveDashboardDateRange({ period, now })
  const aggregates = await queryCommentRanking(range)
  const users = await loadRankingUsers(aggregates.map((item) => item.userId))
  return buildRanking(aggregates, users, range)
}

export async function getConsultationRanking(period: DashboardRankingPeriod, now = new Date()) {
  const range = resolveDashboardDateRange({ period, now })
  const aggregates = await queryConsultationRanking(range)
  const users = await loadRankingUsers(aggregates.map((item) => item.userId))
  return buildRanking(aggregates, users, range)
}

export async function getDashboardRankings(input: DashboardRankingPeriod | DashboardDateRangeInput, now = new Date()): Promise<DashboardRankingsResult> {
  const range = typeof input === 'string'
    ? resolveDashboardDateRange({ period: input, now })
    : resolveDashboardDateRange({ ...input, now: input.now || now })
  const [postAggregates, commentAggregates, consultationAggregates] = await Promise.all([
    queryPostRanking(range),
    queryCommentRanking(range),
    queryConsultationRanking(range),
  ])
  const users = await loadRankingUsers([
    ...postAggregates.map((item) => item.userId),
    ...commentAggregates.map((item) => item.userId),
    ...consultationAggregates.map((item) => item.userId),
  ])

  return {
    period: range.period,
    range,
    postRanking: buildRanking(postAggregates, users, range),
    commentRanking: buildRanking(commentAggregates, users, range),
    consultationRanking: buildRanking(consultationAggregates, users, range),
  }
}
