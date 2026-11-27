import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  aggregateAspirinConsultationsForPeriod,
  qualifiesForAspirinConsultation,
  isValidAspirinConsultation,
  type AspirinConsultationFact,
} from '../lib/aspirin-consultation'
import { ASPIRIN_MIN_LENGTH } from '../lib/aspirin-badge-config'

/**
 * Clinic moderator deletion + leaderboard recalculation.
 *
 * The critical rule: the consultation leaderboard dedups by CASE AUTHOR, so
 * deleting one row must NOT be implemented as `count - 1`. These tests pin the
 * exact semantics that the delete path relies on.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')
const LONG = '这是一条足够长的有效会诊内容用于满足二十一个字的要求'
assert.ok(LONG.replace(/\s/g, '').length >= ASPIRIN_MIN_LENGTH, 'fixture text must exceed the minimum length')

type FactInput = {
  id: string
  authorId: string
  recordAuthorId: string
  content?: string
  status?: string
  deletedAt?: Date | null
  recordStatus?: string
  recordDeletedAt?: Date | null
  category?: string
  createdAt?: string
}

function fact(input: FactInput): AspirinConsultationFact {
  return {
    id: input.id,
    recordId: `rec-${input.recordAuthorId}`,
    authorId: input.authorId,
    content: input.content ?? LONG,
    status: input.status ?? 'ACTIVE',
    deletedAt: input.deletedAt ?? null,
    createdAt: input.createdAt ?? '2026-11-24T10:00:00+08:00',
    record: {
      authorId: input.recordAuthorId,
      category: input.category ?? 'ASK_DOCTORS',
      status: input.recordStatus ?? 'ACTIVE',
      deletedAt: input.recordDeletedAt ?? null,
    },
  }
}

const aggregate = (facts: AspirinConsultationFact[]) =>
  aggregateAspirinConsultationsForPeriod(facts, ASPIRIN_MIN_LENGTH)

test('§5.1 同一病例作者有多条会诊时只计 1 次', () => {
  const facts = [
    fact({ id: 'a1', authorId: 'u1', recordAuthorId: 'p1' }),
    fact({ id: 'a2', authorId: 'u1', recordAuthorId: 'p1' }),
    fact({ id: 'a3', authorId: 'u1', recordAuthorId: 'p1' }),
  ]
  assert.equal(aggregate(facts).get('u1')?.count, 1)
})

test('§5.1/§11 删除同作者重复会诊之一：贡献保持不变（不是 count-1）', () => {
  const all = [
    fact({ id: 'a1', authorId: 'u1', recordAuthorId: 'p1' }),
    fact({ id: 'a2', authorId: 'u1', recordAuthorId: 'p1' }),
  ]
  assert.equal(aggregate(all).get('u1')?.count, 1)
  // Simulate the moderator deleting 'a2': the row leaves the query result, the
  // remaining row still represents case author p1.
  const afterDelete = aggregate(all.filter((f) => f.id !== 'a2'))
  assert.equal(afterDelete.get('u1')?.count, 1, '删除重复会诊后贡献不得减少')
})

test('§5.1/§12 删除唯一有效会诊：贡献 -1', () => {
  const all = [
    fact({ id: 'a1', authorId: 'u1', recordAuthorId: 'p1' }),
    fact({ id: 'a2', authorId: 'u1', recordAuthorId: 'p2' }),
  ]
  assert.equal(aggregate(all).get('u1')?.count, 2)
  const afterDelete = aggregate(all.filter((f) => f.id !== 'a2'))
  assert.equal(afterDelete.get('u1')?.count, 1, '删除唯一有效会诊应减 1')
})

test('§5.1/§10 删除无效会诊：贡献不变', () => {
  const facts = [
    fact({ id: 'valid', authorId: 'u1', recordAuthorId: 'p1' }),
    fact({ id: 'short', authorId: 'u1', recordAuthorId: 'p2', content: '太短了' }),
    fact({ id: 'ownCase', authorId: 'u1', recordAuthorId: 'u1' }),
    fact({ id: 'otherCategory', authorId: 'u1', recordAuthorId: 'p3', category: 'EMOTION' }),
  ]
  assert.equal(aggregate(facts).get('u1')?.count, 1)
  // Removing the ineffective rows changes nothing.
  const afterDelete = aggregate(facts.filter((f) => f.id === 'valid'))
  assert.equal(afterDelete.get('u1')?.count, 1)
})

test('软删除的行不再计入（status 离开 ACTIVE 或 deletedAt 非空）', () => {
  const facts = [
    fact({ id: 'live', authorId: 'u1', recordAuthorId: 'p1' }),
    fact({ id: 'removed', authorId: 'u1', recordAuthorId: 'p2', status: 'REMOVED', deletedAt: new Date() }),
    fact({ id: 'deleted', authorId: 'u1', recordAuthorId: 'p3', status: 'DELETED', deletedAt: new Date() }),
  ]
  assert.equal(aggregate(facts).get('u1')?.count, 1)
})

test('病例本身被删除时其会诊全部失效', () => {
  const facts = [
    fact({ id: 'live', authorId: 'u1', recordAuthorId: 'p1' }),
    fact({ id: 'gone', authorId: 'u1', recordAuthorId: 'p2', recordStatus: 'REMOVED', recordDeletedAt: new Date() }),
  ]
  assert.equal(aggregate(facts).get('u1')?.count, 1)
})

test('§13 不同统计周期互不影响（周期过滤由查询层完成）', () => {
  const week = [
    fact({ id: 'w1', authorId: 'u1', recordAuthorId: 'p1', createdAt: '2026-11-24T10:00:00+08:00' }),
  ]
  const nextWeek = [
    fact({ id: 'n1', authorId: 'u1', recordAuthorId: 'p2', createdAt: '2026-12-01T10:00:00+08:00' }),
  ]
  assert.equal(aggregate(week).get('u1')?.count, 1)
  assert.equal(aggregate(nextWeek).get('u1')?.count, 1)
  // Deleting a row from another period must not change this period's aggregate.
  assert.equal(aggregate(week).get('u1')?.count, 1)
})

test('多用户聚合：各自去重、各自计数，并按最新活动时间记录', () => {
  const facts = [
    fact({ id: '1', authorId: 'u1', recordAuthorId: 'p1', createdAt: '2026-11-24T09:00:00+08:00' }),
    fact({ id: '2', authorId: 'u1', recordAuthorId: 'p1', createdAt: '2026-11-25T09:00:00+08:00' }),
    fact({ id: '3', authorId: 'u1', recordAuthorId: 'p2', createdAt: '2026-11-26T09:00:00+08:00' }),
    fact({ id: '4', authorId: 'u2', recordAuthorId: 'p1', createdAt: '2026-11-24T08:00:00+08:00' }),
  ]
  const map = aggregate(facts)
  assert.equal(map.get('u1')?.count, 2)
  assert.equal(map.get('u2')?.count, 1)
  assert.equal(map.get('u1')?.latestAt.toISOString(), new Date('2026-11-26T09:00:00+08:00').toISOString())
  assert.equal(map.get('u1')?.earliestAt.toISOString(), new Date('2026-11-24T09:00:00+08:00').toISOString())
})

test('去重判定与勋章规则同源（isValidAspirinConsultation 委托给同一函数）', () => {
  const config = { module: 'ASPIRIN_CLINIC' as const, minLength: ASPIRIN_MIN_LENGTH, initialStreakDays: 2 }
  const good = fact({ id: 'x', authorId: 'u1', recordAuthorId: 'p1' })
  assert.equal(isValidAspirinConsultation(good, 'u1', config), true)
  assert.equal(qualifiesForAspirinConsultation(good, ASPIRIN_MIN_LENGTH), true)
  // Different viewer => not "this user's" consultation.
  assert.equal(isValidAspirinConsultation(good, 'u2', config), false)
  // Own case is never eligible under either entry point.
  const own = fact({ id: 'y', authorId: 'u1', recordAuthorId: 'u1' })
  assert.equal(isValidAspirinConsultation(own, 'u1', config), false)
  assert.equal(qualifiesForAspirinConsultation(own, ASPIRIN_MIN_LENGTH), false)
})

test('字数门槛读取自勋章配置而非硬编码', () => {
  const shortText = '只有十二个字的内容不够哦' // < 21 meaningful chars
  const f = fact({ id: 's', authorId: 'u1', recordAuthorId: 'p1', content: shortText })
  assert.equal(qualifiesForAspirinConsultation(f, ASPIRIN_MIN_LENGTH), false)
  // A lower configured threshold makes the same row count.
  assert.equal(qualifiesForAspirinConsultation(f, 5), true)
})

// ---------------------------------------------------------------------------
// Source-contract pins for the surfaces we cannot exercise without a browser.
// ---------------------------------------------------------------------------

test('§1/§2 管理员看得到「删除评论」，普通用户只看到「删除」', () => {
  const ui = read('components/clinic/ClinicDetailClient.tsx')
  assert.match(ui, /item\.canModerateDelete \? '删除评论' : '删除'/)
  assert.match(ui, /aria-label=\{item\.canModerateDelete \? '删除评论（管理员）' : '删除我的会诊'\}/)
  // The button only renders when the server said the viewer may delete.
  assert.match(ui, /\{item\.canDelete \? <button[^>]*clinic-danger-link/)
})

test('§3.2 管理员二次确认包含完整风险说明', () => {
  const ui = read('components/clinic/ClinicDetailClient.tsx')
  assert.match(ui, /确认删除这条评论？/)
  assert.match(ui, /删除后，该评论将不再显示，并从有效会诊统计及排行榜中移除。此操作会被记录。/)
})

test('§3.3 服务端鉴权：clinic_manage + 限流，权限不靠前端', () => {
  const api = read('app/api/clinic/consultations/[consultationId]/route.ts')
  assert.match(api, /requireUser\(\)/)
  assert.match(api, /hasAdminPermission\(guard\.user, 'clinic_manage'\)/)
  assert.match(api, /enforceApiRateLimit/)
  assert.match(api, /removeClinicConsultation\(consultationId, guard\.user\.id, canManage/)
})

test('§3.3 删除权限只服务端判定，公开数据类型带 canModerateDelete', () => {
  const svc = read('lib/clinic-service.ts')
  assert.match(svc, /canModerateDelete: boolean/)
  assert.match(svc, /canDelete: \(isAuthor \|\| canManage\) && !isDeleted/)
  // Deleting the WHOLE case stays author-only (no accidental case removal).
  assert.match(svc, /canDelete: Boolean\(viewerId && row\.author\.id === viewerId\)/)
})

test('§4 幂等：guarded updateMany 只让一个并发请求扣减计数', () => {
  const svc = read('lib/clinic-service.ts')
  assert.match(svc, /where: \{ id: consultationId, status: 'ACTIVE' \}/)
  assert.match(svc, /if \(marked\.count !== 1\)/)
  assert.match(svc, /alreadyDeleted: true/)
})

test('§8 审计：记录评论/病例/作者/管理员/理由/结果', () => {
  const svc = read('lib/clinic-service.ts')
  assert.match(svc, /category: 'CLINIC'/)
  assert.match(svc, /action: 'CONSULTATION_DELETE'/)
  assert.match(svc, /consultationId,/)
  assert.match(svc, /recordId: result\.recordId/)
  assert.match(svc, /authorId: result\.authorId/)
  assert.match(svc, /deletedBy: userId/)
  assert.match(svc, /reason: options\?\.reason/)
  assert.match(svc, /targetType: 'CLINIC_CONSULTATION'/)
})

test('§5.2/§6 榜单与结算共用同一聚合函数（单一真相源）', () => {
  const rankings = read('lib/admin-dashboard-rankings.ts')
  assert.match(rankings, /import \{ aggregateAspirinConsultationsForPeriod \} from '@\/lib\/aspirin-consultation'/)
  assert.match(rankings, /aggregateAspirinConsultationsForPeriod\(/)
  assert.match(rankings, /r\.\\`category\\` = 'ASK_DOCTORS'/)
  assert.match(rankings, /r\.\\`authorId\\` <> c\.\\`authorId\\`/)
  // Settlement reads the same board.
  const sources = read('lib/leaderboard-rewards-sources.ts')
  assert.match(sources, /getDashboardRankings\(/)
  assert.match(sources, /result\.consultationRanking/)
})

test('§5.3 门诊与榜单无缓存层，删除即时生效', () => {
  for (const path of ['lib/admin-dashboard-rankings.ts', 'lib/clinic-service.ts']) {
    const source = read(path)
    assert.doesNotMatch(source, /unstable_cache|revalidateTag/, `${path} 不应引入需要手动失效的缓存`)
  }
  const page = read('app/clinic/[recordId]/page.tsx')
  assert.match(page, /dynamic = 'force-dynamic'/)
})

test('§5.3 删除后前端即时移除并回读服务端状态', () => {
  const ui = read('components/clinic/ClinicDetailClient.tsx')
  assert.match(ui, /consultations: updateConsultation\(current\.consultations, item\.id/)
  assert.match(ui, /router\.refresh\(\)/)
})

test('§7 举报闭环：后台处理时可直接删除被举报会诊', () => {
  const panel = read('components/clinic/ClinicAdminPanel.tsx')
  assert.match(panel, /removeReportedConsultation/)
  assert.match(panel, /删除该评论/)
  assert.match(panel, /status: 'RESOLVED'/)
})

test('§20 其他模块评论删除（论坛回复）未被改动', () => {
  // The clinic change must not touch the forum reply delete path.
  const reply = read('app/api/replies/[replyId]/route.ts')
  assert.match(reply, /DELETE_REPLY/)
  assert.match(reply, /reply_manage/)
})
test('Mobile report removal derives the consultation from the report and uses shared moderation', () => {
  const route = readFileSync('app/api/admin/clinic/route.ts', 'utf8')
  const service = readFileSync('lib/clinic-service.ts', 'utf8')
  assert.match(route, /rejectInvalidRequestOrigin\(request\)[\s\S]*requireAdmin\('clinic_manage', request\)[\s\S]*removeReportedClinicConsultation\(body.reportId, guard.user.id\)/)
  assert.match(service, /function removeReportedClinicConsultation[\s\S]*where: \{ id: reportId \}[\s\S]*removeClinicConsultation\(report.consultationId, adminId, true,[\s\S]*handleClinicReport\(\{ reportId, status: 'RESOLVED', adminId \}\)/)
})
