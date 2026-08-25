import type { Prisma } from '@prisma/client'

import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { parseBeijingDate } from '@/lib/checkin'
import { publicPostWhere } from '@/lib/post-moderation'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const DASHBOARD_RANKING_LIMIT = 10

export type DashboardRankingPeriod = 'week' | 'month'

export type DashboardPeriodRange = {
  period: DashboardRankingPeriod
  start: Date
  end: Date
}

export type DashboardRankingEntry = {
  rank: number
  userId: string
  uid: number
  nickname: string
  avatarUrl: string | null
  displayId: string
  count: number
  period: DashboardRankingPeriod
  periodStart: Date
  periodEnd: Date
}

export type DashboardRankingsResult = {
  period: DashboardRankingPeriod
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
  return value === 'week' || value === 'month' ? value : null
}

function dateKeyToShanghaiStart(dateKey: string) {
  const date = parseBeijingDate(dateKey)
  if (!date) throw new RangeError(`Invalid Shanghai date key: ${dateKey}`)
  return date
}

function getPreviousMondayKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  const daysSinceMonday = (weekday + 6) % 7
  const monday = new Date(Date.UTC(year, month - 1, day - daysSinceMonday))
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}-${String(monday.getUTCDate()).padStart(2, '0')}`
}

export function getDashboardPeriodRange(period: DashboardRankingPeriod, now = new Date()): DashboardPeriodRange {
  const end = new Date(now)
  if (Number.isNaN(end.getTime())) throw new RangeError('Invalid dashboard ranking date')

  const dateKey = getBeijingDateKey(end)
  const start = period === 'month'
    ? dateKeyToShanghaiStart(`${dateKey.slice(0, 7)}-01`)
    : dateKeyToShanghaiStart(getPreviousMondayKey(dateKey))

  return { period, start, end }
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
      createdAt: { gte: range.start, lt: range.end },
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
      createdAt: { gte: range.start, lt: range.end },
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
      createdAt: { gte: range.start, lt: range.end },
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
      periodEnd: range.end,
    }]
  })
}

export async function getPostRanking(period: DashboardRankingPeriod, now = new Date()) {
  const range = getDashboardPeriodRange(period, now)
  const aggregates = await queryPostRanking(range)
  const users = await loadRankingUsers(aggregates.map((item) => item.userId))
  return buildRanking(aggregates, users, range)
}

export async function getCommentRanking(period: DashboardRankingPeriod, now = new Date()) {
  const range = getDashboardPeriodRange(period, now)
  const aggregates = await queryCommentRanking(range)
  const users = await loadRankingUsers(aggregates.map((item) => item.userId))
  return buildRanking(aggregates, users, range)
}

export async function getConsultationRanking(period: DashboardRankingPeriod, now = new Date()) {
  const range = getDashboardPeriodRange(period, now)
  const aggregates = await queryConsultationRanking(range)
  const users = await loadRankingUsers(aggregates.map((item) => item.userId))
  return buildRanking(aggregates, users, range)
}

export async function getDashboardRankings(period: DashboardRankingPeriod, now = new Date()): Promise<DashboardRankingsResult> {
  const range = getDashboardPeriodRange(period, now)
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
    period,
    range,
    postRanking: buildRanking(postAggregates, users, range),
    commentRanking: buildRanking(commentAggregates, users, range),
    consultationRanking: buildRanking(consultationAggregates, users, range),
  }
}
