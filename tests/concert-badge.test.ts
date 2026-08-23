import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planConcertBadgeAwards, type ConcertBadgeDefinition } from '@/lib/concert-badge'

const root = process.cwd()
const read = (p: string) => readFileSync(`${root}/${p}`, 'utf8')

const schema = read('prisma/schema.prisma')
const attendance = read('app/api/music/live/concerts/[concertId]/attendance/route.ts')
const createApi = read('app/api/admin/music/badges/route.ts')
const adminNav = read('app/admin/music/page.tsx')

const tourBadge: ConcertBadgeDefinition = {
  id: 'tour-badge', code: 'TOUR_BADGE', slug: 'tour-badge', name: '巡演纪念', musicTourId: 'tour-a',
  ruleId: null, ruleType: null, operator: null, threshold: null,
  targetConcertId: null, targetTourId: null,
}
const countBadge = (threshold: number, id = `count-${threshold}`): ConcertBadgeDefinition => ({
  id, code: `CONCERT_${threshold}`, slug: `concert-${threshold}`, name: `${threshold}场纪念`, musicTourId: null,
  ruleId: `rule-${threshold}`, ruleType: 'CONCERT_ATTENDANCE_COUNT', operator: 'GTE', threshold,
  targetConcertId: null, targetTourId: null,
})
const facts = [
  { concertId: 'concert-1', tourId: 'tour-a', createdAt: new Date('2025-01-01T00:00:00Z') },
  { concertId: 'concert-2', tourId: 'tour-b', createdAt: new Date('2025-02-01T00:00:00Z') },
  { concertId: 'concert-3', tourId: 'tour-b', createdAt: new Date('2025-03-01T00:00:00Z') },
]

test('Badge 模型新增 category 枚举与 musicTourId 关联（复用现有 Badge / UserBadge）', () => {
  assert.match(schema, /enum BadgeCategory\s*\{[\s\S]*?SYSTEM[\s\S]*?BIRTHDAY[\s\S]*?CONCERT/)
  assert.match(schema, /model Badge\s*\{[\s\S]*?musicTourId\s+String\?/)
  assert.match(schema, /musicTour\s+MusicTour\?\s+@relation\(fields:\s*\[musicTourId\]/)
  // 不破坏生日徽章逻辑：仍按 slug 唯一授予
  assert.match(schema, /model UserBadge\s*\{[\s\S]*?@@unique\(\[userId,\s*badgeId\]\)/)
})

test('0 场演唱会不会产生任何演唱会勋章计划', () => {
  assert.deepEqual(planConcertBadgeAwards({ attendances: [], badges: [tourBadge, countBadge(1)] }), [])
})

test('已有 1 场历史事实且无勋章时会计划补发巡演与累计勋章', () => {
  const awards = planConcertBadgeAwards({ attendances: facts.slice(0, 1), badges: [tourBadge, countBadge(1)] })
  assert.deepEqual(awards.map((award) => award.badge.id), ['tour-badge', 'count-1'])
  assert.equal(awards[0]?.obtainedAt.toISOString(), facts[0]?.createdAt.toISOString())
})

test('已拥有勋章重新 evaluate 不再产生补发计划', () => {
  const awards = planConcertBadgeAwards({ attendances: facts, badges: [tourBadge, countBadge(1)], ownedBadgeIds: new Set(['tour-badge', 'count-1']) })
  assert.deepEqual(awards, [])
})

test('达到多个累计门槛时一次补齐全部缺失勋章', () => {
  const awards = planConcertBadgeAwards({ attendances: facts, badges: [countBadge(1), countBadge(2), countBadge(3), countBadge(4)] })
  assert.deepEqual(awards.map((award) => award.badge.code), ['CONCERT_1', 'CONCERT_2', 'CONCERT_3'])
})

test('连续 dry-run 规划保持幂等，写入后第二次新增数为 0', () => {
  const badges = [tourBadge, countBadge(1), countBadge(3)]
  const first = planConcertBadgeAwards({ attendances: facts, badges })
  const second = planConcertBadgeAwards({ attendances: facts, badges, ownedBadgeIds: new Set(first.map((award) => award.badge.id)) })
  assert.equal(first.length, 3)
  assert.equal(second.length, 0)
})

test('并发最终由 UserBadge 唯一键与 grantBadge P2002 处理保护', () => {
  assert.match(schema, /model UserBadge\s*\{[\s\S]*?@@unique\(\[userId,\s*badgeId\]\)/)
  assert.match(read('lib/badge-service.ts'), /error\.code === 'P2002'[\s\S]*?userId_badgeId/)
})

test('5. 普通用户不能创建徽章（创建接口必须管理员权限）', () => {
  assert.match(createApi, /requireAdmin\('music_manage'\)/)
  assert.match(createApi, /if\s*\(!guard\.user\)\s*return guard\.response/)
  // 创建接口把 category 固定为 CONCERT 并强制关联巡演
  assert.match(createApi, /category:\s*'CONCERT'/)
  assert.match(createApi, /请选择关联的巡演/)
})

test('接入我的现场：成功保存后触发自动授予且失败不影响主流程', () => {
  assert.match(attendance, /import\s*\{[^}]*evaluateConcertBadges[^}]*\}\s*from\s*'@\/lib\/concert-badge'/)
  assert.match(attendance, /await evaluateConcertBadges\(guard\.user\.id\)/)
  // 包在 try/catch 中，异常仅记录日志
  assert.match(attendance, /catch\s*\(error\)\s*\{\s*\n?\s*console\.error\('\[attendance\.concertBadge\]'/)
})

test('批量入口也只调用一次事实评估器，历史数据由只读 dry-run/backfill 覆盖', () => {
  const bulk = read('app/api/music/live/attendance/bulk/route.ts')
  const script = read('scripts/backfill-concert-badges.ts')
  assert.match(bulk, /result\.addedCount > 0[\s\S]*?await evaluateConcertBadges\(guard\.user\.id\)/)
  assert.equal((bulk.match(/evaluateConcertBadges\(guard\.user\.id\)/g) || []).length, 1)
  assert.match(script, /READ-ONLY DRY RUN/)
  assert.equal(['CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED'].every((ruleType) => script.includes(ruleType)), true)
  assert.match(script, /if \(options\.apply\)[\s\S]*?evaluateConcertBadges/)
  assert.match(script, /No database writes were performed/)
})

test('后台演唱会徽章入口已挂载到音乐管理页', () => {
  assert.match(adminNav, /\/admin\/music\/badges/)
})

test('个人主页徽章展示已覆盖 CONCERT 分类（无需改显示逻辑）', () => {
  // public-modules API 返回全部 UserBadge，无 category 过滤，CONCERT 徽章自动出现
  const pub = read('app/api/users/[userId]/public-modules/route.ts')
  assert.match(pub, /prisma\.userBadge\.findMany\(\{\s*where:\s*\{\s*userId:\s*target\.id,\s*isHidden:\s*false/)
})
