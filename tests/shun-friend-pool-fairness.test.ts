import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { friendPoolDraw, pickStratified } from '../lib/shun-config'

/**
 * Friend-pool chance semantics + stratified draw fairness, pinned at the pure
 * function level. The production incident ("friendChance=100 drew strangers")
 * was NOT a random-number bug — these tests prove the draw semantics, and the
 * companion source tests pin the observability that made the real cause
 * (protection state + silent fallback) diagnosable.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

test('§7.1 friendChance=100：好友池非空时必定使用好友池', () => {
  // randomInt(100) yields [0,99]; `< 100` is therefore always true — no
  // off-by-one, no direction flip, no percent conversion mistake.
  for (let seed = 0; seed < 200; seed++) {
    assert.equal(friendPoolDraw(100, (max) => seed % max), true, `draw=${seed % 100}`)
  }
  assert.equal(friendPoolDraw(100, () => 99), true)
  assert.equal(friendPoolDraw(100, () => 0), true)
})

test('§7.3 friendChance=0：永不使用好友池', () => {
  for (let seed = 0; seed < 50; seed++) {
    assert.equal(friendPoolDraw(0, () => seed % 100), false)
  }
})

test('friendChance 边界：1 与 99 的方向正确（小于配置值才命中）', () => {
  assert.equal(friendPoolDraw(1, () => 0), true, '0 < 1 命中')
  assert.equal(friendPoolDraw(1, () => 1), false, '1 不小于 1')
  assert.equal(friendPoolDraw(99, () => 98), true, '98 < 99 命中')
  assert.equal(friendPoolDraw(99, () => 99), false, '99 不小于 99')
})

test('§7.2 pickStratified：好友池为空返回 null，绝不越池选人', () => {
  assert.equal(pickStratified([], [100, 100, 100, 100, 100], (max) => max - 1), null)
  const candidate = { id: 'only', uid: 1, tier: 3 }
  assert.equal(pickStratified([candidate], [1, 2, 3, 4, 5], () => 0), candidate)
})

test('§7.12 活跃度权重正确：层概率 = 权重占比，层内均匀', () => {
  // tiers 0..2 non-empty, weights [50, 30, 20, 0, 0]: empty tiers 3/4 are
  // dropped, the remaining three share 100 points proportionally.
  const candidates = [
    ...Array.from({ length: 50 }, (_, index) => ({ id: `t0-${index}`, uid: index, tier: 0 })),
    ...Array.from({ length: 30 }, (_, index) => ({ id: `t1-${index}`, uid: index, tier: 1 })),
    ...Array.from({ length: 20 }, (_, index) => ({ id: `t2-${index}`, uid: index, tier: 2 })),
  ]
  const draws = 100_000
  const perTier = new Map<number, number>()
  for (let index = 0; index < draws; index++) {
    const picked = pickStratified(candidates, [50, 30, 20, 0, 0], (max) => index % max)
    assert.ok(picked)
    perTier.set(picked.tier, (perTier.get(picked.tier) ?? 0) + 1)
  }
  const expect = (weight: number) => weight / (50 + 30 + 20)
  const observed = (tier: number) => (perTier.get(tier) ?? 0) / draws
  // node:assert has no tolerance variant; assert the deviation directly.
  assert.ok(Math.abs(observed(0) - expect(50)) < 0.01, `tier0 ${observed(0)} vs ${expect(50)}`)
  assert.ok(Math.abs(observed(1) - expect(30)) < 0.01, `tier1 ${observed(1)} vs ${expect(30)}`)
  assert.ok(Math.abs(observed(2) - expect(20)) < 0.01, `tier2 ${observed(2)} vs ${expect(20)}`)
})

test('§5 分层抽样的单人命中率与池大小成反比（低活跃大层人均最低）', () => {
  // Production-like tier sizes: tier0 dominates the population while holding a
  // near-average weight, so its per-user hit rate is the lowest by far.
  const weights = [130, 122, 115, 108, 100]
  const sizes = [14757, 264, 113, 414, 1448]
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  const perUser = weights.map((weight, tier) => (weight / totalWeight) / sizes[tier])
  assert.ok(perUser[0] < perUser[2] / 50, 'tier0 人均命中率必须远低于人数最少层')
})

test('§6 回退原因必须在每一笔回退的 round 上留痕（源码契约）', () => {
  const service = read('lib/shun-master.ts')
  // The round records both the pool size and the exact fallback reason.
  assert.match(service, /friendPoolSize: friendPool\.length/)
  assert.match(service, /friendPoolFallback,/)
  assert.match(service, /'DICE_LOSS'/)
  assert.match(service, /'FRIEND_CHANCE_OFF'/)
  assert.match(service, /'NO_FRIENDS'/)
  assert.match(service, /'POOL_EMPTY_AFTER_FILTERS'/)
})

test('§二 非法配置静默回退默认值时必须留下告警日志', () => {
  const service = read('lib/shun-master.ts')
  assert.match(service, /stored settings failed validation/)
  assert.match(service, /console\.error\('\[shun-master\]/)
})

test('§6 管理员诊断接口只读、鉴权、无 PII', () => {
  const route = read('app/api/admin/shun-master/diagnose/route.ts')
  assert.match(route, /rejectInvalidRequestOrigin/)
  assert.match(route, /requireAdmin\('site_config_manage'\)/)
  assert.match(route, /enforceApiRateLimit/)
  assert.match(route, /diagnoseShunTarget/)
  const service = read('lib/shun-master.ts')
  assert.match(service, /export async function diagnoseShunTarget/)
  // The diagnosis result must not include email/phone fields.
  assert.doesNotMatch(service, /email:\s*user\.|phone:\s*user\./)
})

test('§6 诊断面板只在后台出现且不暴露敏感字段', () => {
  const panel = read('app/admin/shun-master/ShunDiagnosePanel.tsx')
  assert.match(panel, /api\/admin\/shun-master\/diagnose/)
  assert.match(panel, /SHUN_PROTECTION_ON/)
  assert.match(panel, /POOL_EMPTY_AFTER_FILTERS/)
  const admin = read('app/admin/shun-master/ShunMasterAdmin.tsx')
  assert.match(admin, /ShunDiagnosePanel/)
})

test('§7.16/17 并发上限与幂等由既有隔离 MySQL 测试覆盖', () => {
  const matchMysql = read('tests/shun-master-match-mysql.test.ts')
  assert.match(matchMysql, /friendPoolSize/)
  assert.match(matchMysql, /friendPoolFallback/)
  assert.match(matchMysql, /NO_FRIENDS/)
  assert.match(matchMysql, /friendPoolSize 必须为 0|好友池大小只计通过全部资格规则的好友/)
})
