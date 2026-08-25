import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  DASHBOARD_RANKING_LIMIT,
  getDashboardPeriodRange,
  parseDashboardRankingPeriod,
  sortRankingAggregates,
} from '../lib/admin-dashboard-rankings'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
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

test('周期解析只接受 week 和 month', () => {
  assert.equal(parseDashboardRankingPeriod('week'), 'week')
  assert.equal(parseDashboardRankingPeriod('month'), 'month')
  assert.equal(parseDashboardRankingPeriod('7d'), null)
  assert.equal(parseDashboardRankingPeriod(null), null)
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
  assert.match(service, /prisma\.reply\.groupBy/)
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
  assert.match(route, /Cache-Control.*no-store/)
  assert.match(route, /postRanking: result\.postRanking/)
  assert.match(route, /commentRanking: result\.commentRanking/)
  assert.match(route, /consultationRanking: result\.consultationRanking/)
})

test('数据面板统一切换周期、三个榜单一起请求，并保留加载态', () => {
  const page = source('app/admin/dashboard/page.tsx')
  const client = source('app/admin/dashboard/DashboardRankings.tsx')
  assert.match(page, /requireAdminPage\('\/admin\/dashboard', 'stats_view'\)/)
  assert.match(client, /useState<RankingPeriod>\('week'\)/)
  assert.match(client, /fetch\(`\/api\/admin\/dashboard\/rankings\?period=\$\{period\}`/)
  assert.match(client, /setLoading\(true\)/)
  assert.match(client, /本周/)
  assert.match(client, /本月/)
  assert.match(client, /TOP 10/)
  assert.match(client, /查看用户/)
  assert.match(client, /<SafeAvatar/)
  assert.match(client, /lg:grid-cols-3/)
})
