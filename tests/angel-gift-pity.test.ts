import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { normalizePharmacyCampaignInput } from '@/lib/pharmacy'
import {
  advancePharmacyPityCount,
  parsePharmacyDrawCount,
  selectPharmacyPityCandidates,
  shouldUsePharmacyPity,
} from '@/lib/pharmacy-pity'
import { calculateAvailablePharmacyDraws } from '@/lib/pharmacy-draw-options'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('固定周期只在第 N 抽触发，普通新款和重复都不会重置', () => {
  assert.equal(shouldUsePharmacyPity({ enabled: true, threshold: 10, pityCount: 8, candidateCount: 1 }), false)
  assert.equal(advancePharmacyPityCount(8, false), 9)
  assert.equal(shouldUsePharmacyPity({ enabled: true, threshold: 10, pityCount: 9, candidateCount: 1 }), true)
  assert.equal(advancePharmacyPityCount(9, true), 0)
  assert.equal(advancePharmacyPityCount(4, false), 5)
})

test('候选池为空时继续累加，候选恢复后立即触发', () => {
  assert.equal(shouldUsePharmacyPity({ enabled: true, threshold: 10, pityCount: 14, candidateCount: 0 }), false)
  assert.equal(advancePharmacyPityCount(14, false), 15)
  assert.equal(shouldUsePharmacyPity({ enabled: true, threshold: 10, pityCount: 15, candidateCount: 1 }), true)
})

test('候选只允许有效未拥有 Badge，并按 PharmacyPrize.isHidden 控制范围', () => {
  const prizes = [
    { id: 'normal-owned', type: 'BADGE', badgeId: 'normal-owned', isHidden: false, weight: 45 },
    { id: 'normal-new', type: 'BADGE', badgeId: 'normal-new', isHidden: false, weight: 45 },
    { id: 'hidden-new', type: 'BADGE', badgeId: 'hidden-new', isHidden: true, weight: 10 },
    { id: 'points', type: 'POINTS', badgeId: null, isHidden: false, weight: 20 },
    { id: 'collection', type: 'BADGE', badgeId: 'collection', isHidden: false, weight: 20 },
  ]
  const owned = new Set(['normal-owned'])
  assert.deepEqual(selectPharmacyPityCandidates(prizes, owned, false, 'collection').map((prize) => prize.id), ['normal-new'])
  assert.deepEqual(selectPharmacyPityCandidates(prizes, owned, true, 'collection').map((prize) => prize.id), ['normal-new', 'hidden-new'])
})

test('抽数严格限制为 1、5、10，按钮可用次数同时受余额和额度限制', () => {
  assert.equal(parsePharmacyDrawCount(1), 1)
  assert.equal(parsePharmacyDrawCount(10), 10)
  for (const value of [0, 2, 3, 4, 6, 7, 8, 9, 11, 100, '5', '10.0']) assert.equal(parsePharmacyDrawCount(value), null)
  assert.equal(calculateAvailablePharmacyDraws({ balance: 26, cost: 27, todayCount: 0, dailyLimit: null, totalCount: 0, totalLimit: null }), 0)
  assert.equal(calculateAvailablePharmacyDraws({ balance: 135, cost: 27, todayCount: 0, dailyLimit: null, totalCount: 0, totalLimit: null }), 5)
  assert.equal(calculateAvailablePharmacyDraws({ balance: 270, cost: 27, todayCount: 0, dailyLimit: null, totalCount: 0, totalLimit: null }), 10)
  assert.equal(calculateAvailablePharmacyDraws({ balance: 1000, cost: 27, todayCount: 6, dailyLimit: 10, totalCount: 8, totalLimit: 14 }), 4)
})

test('管理员配置要求启用时提供正整数，关闭时旧主题保持默认关闭', () => {
  assert.equal(normalizePharmacyCampaignInput({ title: '旧主题', drawCost: 27, status: 'DRAFT' }).pityEnabled, false)
  const configured = normalizePharmacyCampaignInput({ title: '新主题', drawCost: 27, status: 'DRAFT', pityEnabled: true, pityThreshold: 10, pityIncludeHidden: true })
  assert.equal(configured.pityEnabled, true)
  assert.equal(configured.pityThreshold, 10)
  assert.equal(configured.pityIncludeHidden, true)
  assert.throws(() => normalizePharmacyCampaignInput({ title: '缺次数', drawCost: 27, status: 'DRAFT', pityEnabled: true }), /保底次数/)
})

test('批量抽取与私有字段只在服务端/管理员路径出现，普通 DTO 不序列化内部模式', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const route = read('app/api/angel-gift/route.ts')
  const client = read('components/AngelGiftClient.tsx')
  assert.match(pharmacy, /executePharmacyDraws/)
  assert.match(pharmacy, /for \(let index = 0; index < drawCount; index \+= 1\)/)
  assert.match(pharmacy, /const selectionTotalWeight = selectedPool\.reduce/)
  assert.match(pharmacy, /calculatePharmacyProbability\(selected\.weight, pool\.totalWeight\)/)
  assert.match(pharmacy, /isPity: usePity/)
  assert.match(pharmacy, /drawMode: row\.isPity/)
  assert.match(route, /drawCount/)
  assert.match(route, /result\.draws/)
  assert.doesNotMatch(client, /pity|guarantee|保底|必出/i)
  assert.doesNotMatch(client, /isPity|drawMode|candidateCount/)
})

test('批量事务先锁用户并预校验完整费用与每日/主题额度', () => {
  const pharmacy = read('lib/pharmacy.ts')
  assert.match(pharmacy, /const lockedUser = await lockUser\(tx, input\.userId\)/)
  assert.match(pharmacy, /todayCount \+ drawCount > campaign\.dailyDrawLimit/)
  assert.match(pharmacy, /totalCount \+ drawCount > campaign\.totalDrawLimit/)
  assert.match(pharmacy, /const batchCost = campaign\.drawCost \* drawCount/)
  assert.match(pharmacy, /prisma\.\$transaction\(async \(tx\)/)
})

test('Schema 与 migration 只新增私有配置、用户主题状态和审计字段', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260918100000_add_angel_gift_private_pity/migration.sql')
  assert.match(schema, /pityEnabled\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /pityThreshold\s+Int\?/)
  assert.match(schema, /pityIncludeHidden\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /model PharmacyUserCampaignState/)
  assert.match(schema, /isPity\s+Boolean\s+@default\(false\)/)
  assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/im)
})
