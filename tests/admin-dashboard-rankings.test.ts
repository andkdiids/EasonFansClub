import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  DASHBOARD_RANKING_PERIODS,
  DASHBOARD_RANKING_LIMIT,
  DASHBOARD_TIME_ZONE,
  DashboardDateRangeError,
  getDashboardPeriodRange,
  parseDashboardRankingPeriod,
  resolveDashboardDateRange,
  sortRankingAggregates,
} from '../lib/admin-dashboard-rankings'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

type CommentReplyFixture = {
  id: string
  postId: string
  authorId: string
  parentId: string | null
  createdAt: Date
}

function countEffectiveCommentEvents(
  replies: ReadonlyArray<CommentReplyFixture>,
  start = new Date('2026-08-24T00:00:00.000Z'),
  endExclusive = new Date('2026-09-01T00:00:00.000Z'),
) {
  const replyById = new Map(replies.map((reply) => [reply.id, reply]))
  const eventKeys = new Set<string>()
  const counts = new Map<string, number>()

  for (const reply of replies) {
    if (reply.createdAt < start || reply.createdAt >= endExclusive) continue

    let eventKey: string
    if (reply.parentId === null) {
      eventKey = `${reply.authorId}:post:${reply.postId}`
    } else {
      let root: CommentReplyFixture | undefined = reply
      const visited = new Set<string>()
      while (root?.parentId) {
        if (visited.has(root.id)) {
          root = undefined
          break
        }
        visited.add(root.id)
        root = replyById.get(root.parentId)
      }
      if (!root || root.authorId === reply.authorId) continue
      eventKey = `${reply.authorId}:thread:${root.id}`
    }

    if (eventKeys.has(eventKey)) continue
    eventKeys.add(eventKey)
    counts.set(reply.authorId, (counts.get(reply.authorId) || 0) + 1)
  }

  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

function fixture(
  id: string,
  authorId: string,
  postId: string,
  parentId: string | null,
  createdAt: string,
): CommentReplyFixture {
  return { id, authorId, postId, parentId, createdAt: new Date(createdAt) }
}

test('本周从北京时间周一 00:00 开始，不是最近 7 天', () => {
  const range = getDashboardPeriodRange('week', new Date('2026-08-26T02:30:00.000Z'))
  assert.equal(range.start.toISOString(), '2026-08-23T16:00:00.000Z')
  assert.equal(range.end.toISOString(), '2026-08-26T02:30:00.000Z')

  const previousWeek = getDashboardPeriodRange('week', new Date('2026-08-23T15:59:59.999Z'))
  assert.equal(previousWeek.start.toISOString(), '2026-08-16T16:00:00.000Z')
})

test('周一 00:00 边界进入新周，UTC 服务器时间仍按 Asia/Shanghai 解释', () => {
  const range = getDashboardPeriodRange('week', new Date('2026-08-23T16:00:00.000Z'))
  assert.equal(range.start.toISOString(), '2026-08-23T16:00:00.000Z')
  assert.equal(range.end.toISOString(), '2026-08-23T16:00:00.000Z')
})

test('本月从北京时间当月 1 日 00:00 开始，不是最近 30 天', () => {
  const range = getDashboardPeriodRange('month', new Date('2026-09-01T00:30:00.000Z'))
  assert.equal(range.start.toISOString(), '2026-08-31T16:00:00.000Z')

  const previousMonth = getDashboardPeriodRange('month', new Date('2026-08-31T15:59:59.999Z'))
  assert.equal(previousMonth.start.toISOString(), '2026-07-31T16:00:00.000Z')
})

test('五个周期都按北京时间解析，并保留旧 week/month URL 兼容', () => {
  assert.deepEqual(
    DASHBOARD_RANKING_PERIODS.map((period) => parseDashboardRankingPeriod(period)),
    [...DASHBOARD_RANKING_PERIODS],
  )
  assert.equal(parseDashboardRankingPeriod('week'), 'week')
  assert.equal(parseDashboardRankingPeriod('month'), 'month')
  assert.equal(parseDashboardRankingPeriod('7d'), null)
  assert.equal(parseDashboardRankingPeriod(null), null)
  assert.equal(DASHBOARD_TIME_ZONE, 'Asia/Shanghai')
})

test('上周是上一个完整周一至周日，结束边界为本周一 00:00', () => {
  const range = resolveDashboardDateRange({ period: 'last_week', now: new Date('2026-08-31T01:00:00.000Z') })

  assert.equal(range.start.toISOString(), '2026-08-23T16:00:00.000Z')
  assert.equal(range.endExclusive.toISOString(), '2026-08-30T16:00:00.000Z')
  assert.equal(range.startDateKey, '2026-08-24')
  assert.equal(range.endDateKey, '2026-08-30')
  assert.equal(range.label, '上周')
})

test('本周和本月结束于服务端当前时间，不计算未来日期', () => {
  const now = new Date('2026-08-31T01:00:00.000Z')
  const week = resolveDashboardDateRange({ period: 'this_week', now })
  const month = resolveDashboardDateRange({ period: 'this_month', now })

  assert.equal(week.endExclusive.getTime(), now.getTime())
  assert.equal(month.endExclusive.getTime(), now.getTime())
  assert.equal(week.endDateKey, '2026-08-31')
  assert.equal(month.startDateKey, '2026-08-01')
})

test('上月按自然月边界计算，并覆盖 28/29/30/31 天月份', () => {
  const cases = [
    ['2026-03-15T00:00:00.000Z', '2026-02-01', '2026-02-28', '2026-01-31T16:00:00.000Z', '2026-02-28T16:00:00.000Z'],
    ['2024-03-15T00:00:00.000Z', '2024-02-01', '2024-02-29', '2024-01-31T16:00:00.000Z', '2024-02-29T16:00:00.000Z'],
    ['2026-05-15T00:00:00.000Z', '2026-04-01', '2026-04-30', '2026-03-31T16:00:00.000Z', '2026-04-30T16:00:00.000Z'],
    ['2026-08-15T00:00:00.000Z', '2026-07-01', '2026-07-31', '2026-06-30T16:00:00.000Z', '2026-07-31T16:00:00.000Z'],
  ] as const

  for (const [now, startDateKey, endDateKey, start, endExclusive] of cases) {
    const range = resolveDashboardDateRange({ period: 'last_month', now: new Date(now) })
    assert.equal(range.startDateKey, startDateKey)
    assert.equal(range.endDateKey, endDateKey)
    assert.equal(range.start.toISOString(), start)
    assert.equal(range.endExclusive.toISOString(), endExclusive)
  }
})

test('自定义范围包含结束日，支持单日、跨月和跨年', () => {
  const singleDay = resolveDashboardDateRange({ period: 'custom', startDate: '2026-08-15', endDate: '2026-08-15' })
  assert.equal(singleDay.start.toISOString(), '2026-08-14T16:00:00.000Z')
  assert.equal(singleDay.endExclusive.toISOString(), '2026-08-15T16:00:00.000Z')
  assert.equal(singleDay.startDateKey, '2026-08-15')
  assert.equal(singleDay.endDateKey, '2026-08-15')

  const crossMonth = resolveDashboardDateRange({ period: 'custom', startDate: '2026-07-25', endDate: '2026-08-05' })
  assert.equal(crossMonth.startDateKey, '2026-07-25')
  assert.equal(crossMonth.endDateKey, '2026-08-05')
  assert.equal(crossMonth.endExclusive.toISOString(), '2026-08-05T16:00:00.000Z')

  const crossYear = resolveDashboardDateRange({ period: 'custom', startDate: '2025-12-25', endDate: '2026-01-05' })
  assert.equal(crossYear.start.toISOString(), '2025-12-24T16:00:00.000Z')
  assert.equal(crossYear.endExclusive.toISOString(), '2026-01-05T16:00:00.000Z')
})

test('自定义日期必填且开始日期不能晚于结束日期', () => {
  assert.throws(
    () => resolveDashboardDateRange({ period: 'custom', startDate: '2026-08-15', endDate: '2026-08-14' }),
    (error: unknown) => error instanceof DashboardDateRangeError
      && error.code === 'CUSTOM_DATE_ORDER'
      && error.message === '开始日期不能晚于结束日期',
  )
  assert.throws(
    () => resolveDashboardDateRange({ period: 'custom', startDate: '2026-08-15' }),
    (error: unknown) => error instanceof DashboardDateRangeError && error.code === 'CUSTOM_DATE_REQUIRED',
  )
  assert.throws(
    () => resolveDashboardDateRange({ period: 'custom', startDate: '2026-02-30', endDate: '2026-03-01' }),
    (error: unknown) => error instanceof DashboardDateRangeError && error.code === 'CUSTOM_DATE_INVALID',
  )
})

test('统计范围使用 [start, endExclusive) 边界，恰好落在结束边界的数据不计入', () => {
  const range = resolveDashboardDateRange({ period: 'last_week', now: new Date('2026-08-31T01:00:00.000Z') })
  const beforeEnd = new Date('2026-08-30T15:59:59.999Z')
  const atEnd = range.endExclusive

  assert.equal(range.start.getTime() <= beforeEnd.getTime(), true)
  assert.equal(beforeEnd.getTime() < range.endExclusive.getTime(), true)
  assert.equal(atEnd.getTime() < range.endExclusive.getTime(), false)
})

test('评论榜按帖子一级评论和他人 root 线程在统计窗口内去重', () => {
  const replies = [
    fixture('a-root-1', 'user-a', 'post-a', null, '2026-08-25T01:00:00.000Z'),
    fixture('a-root-2', 'user-a', 'post-a', null, '2026-08-25T02:00:00.000Z'),
    fixture('a-root-3', 'user-a', 'post-a', null, '2026-08-25T03:00:00.000Z'),
    fixture('a-post-b', 'user-a', 'post-b', null, '2026-08-25T04:00:00.000Z'),
    fixture('b-in-a-thread', 'user-b', 'post-a', 'a-root-1', '2026-08-25T05:00:00.000Z'),
    fixture('a-replies-back', 'user-a', 'post-a', 'b-in-a-thread', '2026-08-25T06:00:00.000Z'),
    fixture('b-continues-thread-1', 'user-b', 'post-a', 'a-replies-back', '2026-08-25T07:00:00.000Z'),
    fixture('b-continues-thread-2', 'user-b', 'post-a', 'b-continues-thread-1', '2026-08-25T07:01:00.000Z'),
    fixture('b-continues-thread-3', 'user-b', 'post-a', 'b-continues-thread-2', '2026-08-25T07:02:00.000Z'),
    fixture('b-continues-thread-4', 'user-b', 'post-a', 'b-continues-thread-3', '2026-08-25T07:03:00.000Z'),
    fixture('b-continues-thread-5', 'user-b', 'post-a', 'b-continues-thread-4', '2026-08-25T07:04:00.000Z'),
    fixture('c-root', 'user-c', 'post-a', null, '2026-08-25T08:00:00.000Z'),
    fixture('b-joins-second-thread', 'user-b', 'post-a', 'c-root', '2026-08-25T09:00:00.000Z'),
    fixture('b-continues-second-thread', 'user-b', 'post-a', 'b-joins-second-thread', '2026-08-25T10:00:00.000Z'),
  ]

  assert.deepEqual(countEffectiveCommentEvents(replies), {
    'user-a': 2,
    'user-b': 2,
    'user-c': 1,
  })
})

test('评论榜去重按统计窗口隔离，窗口外历史行为不会永久占用资格', () => {
  const replies = [
    fixture('old-top-level', 'user-a', 'post-a', null, '2026-08-01T01:00:00.000Z'),
    fixture('current-top-level', 'user-a', 'post-a', null, '2026-08-25T01:00:00.000Z'),
    fixture('old-root', 'user-b', 'post-b', null, '2026-08-01T02:00:00.000Z'),
    fixture('current-thread-entry', 'user-a', 'post-b', 'old-root', '2026-08-25T02:00:00.000Z'),
  ]

  assert.deepEqual(
    countEffectiveCommentEvents(replies, new Date('2026-08-24T00:00:00.000Z'), new Date('2026-09-01T00:00:00.000Z')),
    { 'user-a': 2 },
  )
})

test('同数量榜单按最后一次行为时间升序，再按 userId 稳定排序，并限制 TOP 10', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    userId: `user-${String(12 - index).padStart(2, '0')}`,
    count: index < 11 ? 5 : 4,
    lastActivityAt: new Date(`2026-08-${String(20 + (index % 3)).padStart(2, '0')}T00:00:00.000Z`),
  }))
  const sorted = sortRankingAggregates(rows)

  assert.equal(sorted.length, DASHBOARD_RANKING_LIMIT)
  assert.equal(sorted[0]?.count, 5)
  assert.ok(sorted.every((row, index) => index === 0 || row.count <= sorted[index - 1]!.count))
  assert.deepEqual(
    sortRankingAggregates([
      { userId: 'b', count: 3, lastActivityAt: new Date('2026-08-20T00:00:00.000Z') },
      { userId: 'a', count: 3, lastActivityAt: new Date('2026-08-20T00:00:00.000Z') },
    ]).map((row) => row.userId),
    ['a', 'b'],
  )
})

test('统计 service 使用真实模型、公开状态和删除过滤', () => {
  const service = source('lib/admin-dashboard-rankings.ts')
  const moderation = source('lib/post-moderation.ts')
  assert.match(service, /prisma\.post\.groupBy/)
  assert.match(service, /prisma\.\$queryRaw<CommentRankingQueryRow\[\]>/)
  assert.match(service, /prisma\.clinicConsultation\.groupBy/)
  assert.match(service, /publicPostWhere/)
  assert.match(moderation, /isDeleted: false[\s\S]*status: 'PUBLISHED'/)
  assert.match(moderation, /moderationStatus: \{ in: publicPostModerationStatuses \}/)
  assert.match(service, /isDeleted: false/)
  assert.match(service, /deletedAt: null/)
  assert.match(service, /Board: \{ isActive: true \}/)
  assert.match(service, /status: 'ACTIVE',[\s\S]*record: \{ status: 'ACTIVE', deletedAt: null \}/)
  assert.match(service, /_count: true/)
  assert.match(service, /_max: \{ createdAt: true \}/)
  assert.match(service, /\{ _count: \{ id: 'desc' \} \}/)
  assert.match(service, /\{ _max: \{ createdAt: 'asc' \} \}/)
  assert.match(service, /\{ authorId: 'asc' \}/)
})

test('评论榜在数据库内解析 root、按有效事件去重并限制 TOP 10', () => {
  const service = source('lib/admin-dashboard-rankings.ts')
  assert.match(service, /WITH RECURSIVE/)
  assert.match(service, /candidate_replies/)
  assert.match(service, /reply_ancestors/)
  assert.match(service, /resolved_roots/)
  assert.match(service, /c\.candidateParentId IS NULL/)
  assert.match(service, /r\.rootAuthorId <> r\.candidateAuthorId/)
  assert.match(service, /GROUP BY userId, eventType, eventId/)
  assert.match(service, /r\.createdAt >= \$\{range\.start\}/)
  assert.match(service, /r\.createdAt < \$\{range\.endExclusive\}/)
  assert.match(service, /LIMIT \$\{DASHBOARD_RANKING_LIMIT\}/)
  assert.doesNotMatch(service, /prisma\.reply\.groupBy/)
  assert.doesNotMatch(service, /reply\.(findMany|findUnique)/)
})

test('三个排行榜在五个周期中复用同一个 resolved range，并由数据库聚合取 TOP 10', () => {
  const service = source('lib/admin-dashboard-rankings.ts')
  for (const period of DASHBOARD_RANKING_PERIODS) {
    const range = resolveDashboardDateRange({
      period,
      startDate: period === 'custom' ? '2026-08-01' : undefined,
      endDate: period === 'custom' ? '2026-08-15' : undefined,
      now: new Date('2026-08-31T01:00:00.000Z'),
    })
    assert.equal(range.period, period)
  }
  assert.match(service, /const range = typeof input === 'string'/)
  assert.match(service, /const \[postAggregates, commentAggregates, consultationAggregates\] = await Promise\.all\(/)
  assert.equal((service.match(/createdAt: \{ gte: range\.start, lt: range\.endExclusive \}/g) || []).length, 2)
  assert.match(service, /r\.createdAt >= \$\{range\.start\}/)
  assert.match(service, /r\.createdAt < \$\{range\.endExclusive\}/)
  assert.match(service, /prisma\.user\.findMany/)
  assert.doesNotMatch(service, /prisma\.user\.findUnique/)
})

test('三个统计模型已有 authorId + createdAt 索引，本轮不需要新增索引', () => {
  const schema = source('prisma/schema.prisma')
  for (const model of ['Post', 'Reply', 'ClinicConsultation']) {
    const start = schema.indexOf(`model ${model} {`)
    const end = schema.indexOf('\n}', start)
    assert.ok(start >= 0 && end > start, `${model} model is missing`)
    assert.match(schema.slice(start, end), /@@index\(\[authorId, createdAt\]\)/, `${model} index is missing`)
  }
})

test('排行榜 API 复用统一 stats_view 管理员权限并返回无缓存响应', () => {
  const route = source('app/api/admin/dashboard/rankings/route.ts')
  assert.match(route, /requireAdmin\('stats_view'\)/)
  assert.match(route, /parseDashboardRankingPeriod/)
  assert.match(route, /\|\| 'this_week'/)
  assert.match(route, /startDate/)
  assert.match(route, /endDate/)
  assert.match(route, /DashboardDateRangeError/)
  assert.match(route, /endExclusive/)
  assert.match(route, /Cache-Control.*no-store/)
  assert.match(route, /postRanking: result\.postRanking/)
  assert.match(route, /commentRanking: result\.commentRanking/)
  assert.match(route, /consultationRanking: result\.consultationRanking/)
})

test('数据面板统一切换周期、三个榜单一起请求，并保留加载态', () => {
  const page = source('app/admin/dashboard/page.tsx')
  const client = source('app/admin/dashboard/DashboardRankings.tsx')
  assert.match(page, /requireAdminPage\('\/admin\/dashboard', 'stats_view'\)/)
  for (const period of DASHBOARD_RANKING_PERIODS) assert.match(client, new RegExp(period))
  assert.match(client, /useState<RankingPeriod>\(urlState\.period\)/)
  assert.match(client, /fetch\(\`\/api\/admin\/dashboard\/rankings\?\$\{query\.toString\(\)\}\`/)
  assert.match(client, /setLoading\(true\)/)
  assert.match(client, /setData\(null\)/)
  assert.match(client, /useSearchParams/)
  assert.match(client, /router\.push/)
  assert.match(client, /aria-pressed/)
  assert.match(client, /startDate/)
  assert.match(client, /endDate/)
  assert.match(client, /开始日期不能晚于结束日期/)
  assert.match(client, /<input type="date"/)
  assert.match(client, /查询/)
  assert.match(client, /本周/)
  assert.match(client, /本月/)
  assert.match(client, /TOP 10/)
  assert.match(client, /当前时间范围暂无有效数据/)
  assert.match(client, /查看用户/)
  assert.match(client, /<SafeAvatar/)
  assert.match(client, /flex-wrap/)
  assert.match(client, /lg:grid-cols-3/)
  assert.match(client, /统计有效评论参与/)
  assert.doesNotMatch(client, /统计有效帖子下的评论与回复/)
})
