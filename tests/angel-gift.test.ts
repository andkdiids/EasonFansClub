import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  ANGEL_GIFT_MODULE_NAME,
  calculatePharmacyProbability,
  chooseWeightedPharmacyPrize,
  effectivePharmacyCampaignStatus,
  normalizePharmacyCampaignInput,
} from '@/lib/pharmacy'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260903120000_add_angel_gift_pharmacy/migration.sql')

test('固定模块名与可配置主题名分离', () => {
  assert.equal(ANGEL_GIFT_MODULE_NAME, '天使的礼物')
  assert.match(schema, /model PharmacyCampaign \{[\s\S]*title\s+String/)
  assert.match(schema, /model PharmacyPrize \{[\s\S]*campaignId\s+String/)
  assert.doesNotMatch(schema, /campaignName\s+天使的礼物/)
})

test('执药费用支持 27、74、127 等后台配置值', () => {
  for (const drawCost of [27, 74, 127]) {
    const campaign = normalizePharmacyCampaignInput({ title: '病态三部曲', drawCost, status: 'DRAFT' })
    assert.equal(campaign.drawCost, drawCost)
  }
})

test('余药回收规则为主题级可配置正整数', () => {
  const campaign = normalizePharmacyCampaignInput({ title: '可配置主题', drawCost: 27, duplicateRecycleEnabled: true, duplicateRecycleRequired: 5, duplicateRecycleReward: 27, status: 'DRAFT' })
  assert.equal(campaign.duplicateRecycleRequired, 5)
  assert.equal(campaign.duplicateRecycleReward, 27)
  assert.throws(() => normalizePharmacyCampaignInput({ title: '缺少规则', drawCost: 74, duplicateRecycleEnabled: true, status: 'DRAFT' }), /余药回收/)
})

test('主题状态以后端时间判断', () => {
  const start = new Date('2026-09-10T00:00:00.000Z')
  const end = new Date('2026-09-20T00:00:00.000Z')
  assert.equal(effectivePharmacyCampaignStatus({ status: 'SCHEDULED', startsAt: start, endsAt: end }, new Date('2026-09-09T00:00:00.000Z')), 'SCHEDULED')
  assert.equal(effectivePharmacyCampaignStatus({ status: 'ACTIVE', startsAt: start, endsAt: end }, new Date('2026-09-15T00:00:00.000Z')), 'ACTIVE')
  assert.equal(effectivePharmacyCampaignStatus({ status: 'ACTIVE', startsAt: start, endsAt: end }, new Date('2026-09-21T00:00:00.000Z')), 'ENDED')
})

test('权重映射边界确定且不依赖前端开奖', () => {
  const prizes = [{ id: 'badge-a', weight: 5 }, { id: 'badge-b', weight: 15 }]
  assert.equal(chooseWeightedPharmacyPrize(prizes, 0).id, 'badge-a')
  assert.equal(chooseWeightedPharmacyPrize(prizes, 4).id, 'badge-a')
  assert.equal(chooseWeightedPharmacyPrize(prizes, 5).id, 'badge-b')
  assert.equal(chooseWeightedPharmacyPrize(prizes, 19).id, 'badge-b')
  assert.throws(() => chooseWeightedPharmacyPrize(prizes, 20), /PHARMACY_ROLL_OUT_OF_RANGE/)
  assert.equal(calculatePharmacyProbability(5, 20), 25)
  assert.doesNotMatch(read('components/AngelGiftClient.tsx'), /Math\.random\(\)/)
  assert.match(read('lib/pharmacy.ts'), /randomInt\(pool\.totalWeight\)/)
})

test('服务端开奖流程复用统一 Badge grant 与挂号费账务服务', () => {
  const source = read('lib/pharmacy.ts')
  assert.match(source, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(source, /consumeRegistrationFee\(tx/)
  assert.match(source, /awardRegistrationFee\(tx/)
  assert.match(source, /grantBadgeWithTransaction\(tx/)
  assert.match(source, /processBadgeGrantEffects/)
  assert.match(source, /sourceType: ANGEL_GIFT_BADGE_SOURCE/)
  assert.match(source, /pharmacy:draw:\$\{drawId\}:cost/)
  assert.match(source, /pharmacy:draw:\$\{drawId\}:reward/)
})

test('奖品快照、幂等约束和余药真实库存已落库', () => {
  assert.match(schema, /model PharmacyDraw \{[\s\S]*idempotencyKey\s+String[\s\S]*campaignTitle[\s\S]*configuredWeight[\s\S]*calculatedProbability/)
  assert.match(schema, /@@unique\(\[userId, idempotencyKey\]\)/)
  assert.match(schema, /model PharmacyDuplicateInventory \{[\s\S]*quantity\s+Int[\s\S]*@@unique\(\[userId, campaignId, sourceBadgeId\]\)/)
  assert.match(schema, /model PharmacyRecycleLog \{[\s\S]*@@unique\(\[userId, idempotencyKey\]\)/)
  assert.match(read('lib/pharmacy.ts'), /pharmacyDuplicateInventory\.upsert/)
  assert.match(read('lib/pharmacy.ts'), /quantity: \{ decrement: take \}/)
})

test('挂号费成本、奖品返还、余药回收使用独立 PointLog 类型', () => {
  for (const action of ['PHARMACY_DRAW_COST', 'PHARMACY_PRIZE_REWARD', 'PHARMACY_DUPLICATE_RECYCLE']) {
    assert.match(schema, new RegExp(`\\b${action}\\b`))
    assert.match(migration, new RegExp(`'${action}'`))
    assert.match(read('lib/registration-fee.ts'), new RegExp(action))
  }
  assert.match(read('lib/pharmacy.ts'), /balanceBefore: lockedUser\.points/)
  assert.match(read('lib/pharmacy.ts'), /balanceAfter: finalBalance/)
})

test('前端请求只提交主题与幂等键，不能控制开奖结果', () => {
  const route = read('app/api/angel-gift/route.ts')
  assert.match(route, /campaignId/)
  assert.match(route, /idempotencyKey/)
  assert.doesNotMatch(route, /prizeId|rewardAmount|badgeId|probability/)
  assert.match(route, /executePharmacyDraw/)
})

test('启用奖品异常由服务器阻止，禁用奖品保留历史快照', () => {
  const source = read('lib/pharmacy.ts')
  assert.match(source, /NO_ENABLED_PRIZES/)
  assert.match(source, /启用奖品权重必须大于 0/)
  assert.match(source, /UNSUPPORTED_PRIZE_TYPE/)
  assert.match(source, /softDeleted: true/)
  assert.match(read('app/admin/angel-gift/AngelGiftAdminManager.tsx'), /历史记录保留/)
})

test('快捷入口和勋章展览馆入口进入同一路由', () => {
  assert.match(read('lib/navigation-registry.ts'), /featureKey: 'ANGEL_GIFT'[\s\S]*href: '\/angel-gift'/)
  assert.match(read('components/BadgeExhibitionHall.tsx'), /href="\/angel-gift"/)
  assert.match(read('components/BadgeExhibitionHall.tsx'), /去药房执一味不知道名字的药。/)
})

test('勋章发放文本通过现有 UserBadge 展示逻辑覆盖', () => {
  const source = read('lib/badge-service.ts')
  assert.match(source, /record\.sourceType === 'ANGEL_GIFT'/)
  assert.match(source, /于「天使的礼物」执药获得/)
  assert.match(read('lib/pharmacy.ts'), /grantReason: `于「\$\{ANGEL_GIFT_MODULE_NAME\}」主题/)
})

test('迁移只增加结构，不连接生产库或写入第一期奖池', () => {
  assert.match(migration, /CREATE TABLE `PharmacyCampaign`/)
  assert.match(migration, /CREATE TABLE `PharmacyPrize`/)
  assert.match(migration, /CREATE TABLE `PharmacyDraw`/)
  assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/im)
  assert.doesNotMatch(read('prisma/seed.ts'), /十面埋伏|打回原形|防不胜防/)
})

test('权限与前后台路由均使用天使的礼物固定命名', () => {
  assert.match(read('lib/admin-permission-config.ts'), /angel_gift_manage/)
  assert.match(read('lib/admin-navigation.ts'), /href: '\/admin\/angel-gift', title: '天使的礼物'/)
  assert.match(read('app/admin/angel-gift/page.tsx'), /天使的礼物/)
  assert.match(read('app/angel-gift/page.tsx'), /title: '天使的礼物 \| 私家E院'/)
})

