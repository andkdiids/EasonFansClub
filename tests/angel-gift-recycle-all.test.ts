import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { planPharmacyRecycleAll } from '../lib/pharmacy-recycle'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const pharmacy = read('lib/pharmacy.ts')
const route = read('app/api/angel-gift/recycle/all/route.ts')
const client = read('components/AngelGiftClient.tsx')

const inventory = (items: Array<[string, number]>) => items.map(([sourceBadgeId, quantity], index) => ({ id: `inventory-${index}`, sourceBadgeId, quantity }))

test('一键回收无可用余药时不生成计划写入', () => {
  const plan = planPharmacyRecycleAll([], 3, 30)
  assert.deepEqual(plan, { totalQuantity: 0, batchCount: 0, recyclableCount: 0, rewardAmount: 0, recyclableTypeCount: 0, remainingQuantity: 0, allocations: [] })
  assert.equal(planPharmacyRecycleAll(inventory([['badge-a', 2]]), 3, 30).recyclableCount, 0)
})

test('单组余药沿用当前主题每组奖励', () => {
  const plan = planPharmacyRecycleAll(inventory([['badge-a', 3]]), 3, 27)
  assert.equal(plan.recyclableCount, 3)
  assert.equal(plan.batchCount, 1)
  assert.equal(plan.rewardAmount, 27)
  assert.equal(plan.remainingQuantity, 0)
})

test('多种勋章的全部完整回收组一次汇总，奖励等于逐组回收', () => {
  const plan = planPharmacyRecycleAll(inventory([['badge-a', 2], ['badge-b', 1], ['badge-c', 3]]), 3, 48)
  assert.equal(plan.totalQuantity, 6)
  assert.equal(plan.recyclableCount, 6)
  assert.equal(plan.batchCount, 2)
  assert.equal(plan.rewardAmount, 96)
  assert.equal(plan.recyclableTypeCount, 3)
  assert.deepEqual(plan.allocations.map(({ sourceBadgeId, quantity }) => [sourceBadgeId, quantity]), [['badge-a', 2], ['badge-b', 1], ['badge-c', 3]])
})

test('单次手动回收后的余药只处理仍然够整组的部分', () => {
  const plan = planPharmacyRecycleAll(inventory([['badge-a', 4], ['badge-b', 3]]), 3, 27)
  assert.equal(plan.totalQuantity, 7)
  assert.equal(plan.batchCount, 2)
  assert.equal(plan.recyclableCount, 6)
  assert.equal(plan.rewardAmount, 54)
  assert.equal(plan.remainingQuantity, 1)
})

test('回收后新产生的余药可由下一次一键操作独立回收', () => {
  const first = planPharmacyRecycleAll(inventory([['badge-a', 7]]), 3, 27)
  assert.equal(first.recyclableCount, 6)
  assert.equal(first.remainingQuantity, 1)
  const later = planPharmacyRecycleAll(inventory([['badge-a', 1], ['badge-b', 2]]), 3, 27)
  assert.equal(later.recyclableCount, 3)
  assert.equal(later.rewardAmount, 27)
})

test('回收分配遵循单个回收的最早库存优先顺序', () => {
  const plan = planPharmacyRecycleAll(inventory([['badge-old', 2], ['badge-new', 3]]), 3, 27)
  assert.deepEqual(plan.allocations.map(({ sourceBadgeId, quantity }) => [sourceBadgeId, quantity]), [['badge-old', 2], ['badge-new', 1]])
  assert.equal(plan.remainingQuantity, 2)
})

test('所有奖品徽章来源使用同一主题门槛，不引入隐藏款或特殊款价格分支', () => {
  const plan = planPharmacyRecycleAll(inventory([['hidden-badge', 3], ['special-badge', 3]]), 3, 27)
  assert.equal(plan.recyclableCount, 6)
  assert.equal(plan.rewardAmount, 54)
  assert.equal(plan.recyclableTypeCount, 2)
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  assert.match(batchService, /campaign\.duplicateRecycleRequired/)
  assert.match(batchService, /campaign\.duplicateRecycleReward/)
  assert.doesNotMatch(batchService, /isHidden|visibility|rarity/u)
})

test('回收规则必须是正整数且数量与奖励溢出会被拒绝', () => {
  assert.throws(() => planPharmacyRecycleAll([], 0, 10), /INVALID_PHARMACY_RECYCLE_RULE/u)
  assert.throws(() => planPharmacyRecycleAll([], 2, -1), /INVALID_PHARMACY_RECYCLE_RULE/u)
  assert.throws(() => planPharmacyRecycleAll(inventory([['badge-a', Number.MAX_SAFE_INTEGER]]), 1, 2), /PHARMACY_RECYCLE_TOTAL_OVERFLOW/u)
})

test('API 只接收请求幂等键，active campaign 和金额由服务端计算', () => {
  assert.match(route, /requireUser\(\)/u)
  assert.match(route, /recycleAllPharmacyDuplicates\(\{ userId: guard\.user\.id, idempotencyKey \}\)/u)
  assert.doesNotMatch(route, /campaignId|rewardAmount|recycledCount|badgeId/u)
})

test('批量回收在事务内解析并锁定当前 active campaign', () => {
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  assert.match(batchService, /prisma\.\$transaction\(async \(tx\)/u)
  assert.match(batchService, /lockUser\(tx, input\.userId\)/u)
  assert.match(batchService, /findActivePharmacyCampaignId\(tx, now\)/u)
  assert.match(batchService, /lockCampaign\(tx, activeCampaignId\)/u)
  assert.match(batchService, /assertCampaignIsCurrent\(campaign\.id/u)
})

test('单次回收和一键回收共用同一 FIFO 规则规划器', () => {
  const singleService = pharmacy.slice(pharmacy.indexOf('export async function recyclePharmacyDuplicates'), pharmacy.indexOf('export type PharmacyRecycleAllResult'))
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  assert.match(singleService, /planPharmacyRecycleAll\(inventory, requiredCount, rewardAmount, 1\)/u)
  assert.match(batchService, /planPharmacyRecycleAll\(inventory, requiredCount, rewardPerBatch\)/u)
})

test('批量查询严格限定当前用户和当前 campaign 的正数量库存', () => {
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  assert.match(batchService, /where: \{ userId: input\.userId, campaignId: campaign\.id, quantity: \{ gt: 0 \} \}/u)
  assert.doesNotMatch(batchService, /userBadge|BadgeInventory/u)
})

test('条件扣减、回收流水和挂号费奖励处于同一事务并失败回滚', () => {
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  assert.match(batchService, /quantity: \{ gte: allocation\.quantity \}/u)
  assert.match(batchService, /quantity: \{ decrement: allocation\.quantity \}/u)
  assert.match(batchService, /pharmacyRecycleLog\.create/u)
  assert.match(batchService, /awardRegistrationFee\(tx/u)
  assert.match(batchService, /pharmacyRecycleLog\.update/u)
  assert.match(batchService, /if \(changed\.count !== 1\) throw/u)
})

test('无完整回收组直接无写入返回；数据库写入仅在正数计划之后发生', () => {
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  const noOp = batchService.indexOf('if (plan.recyclableCount === 0)')
  const firstWrite = batchService.indexOf('pharmacyDuplicateInventory.updateMany')
  assert.ok(noOp >= 0 && firstWrite > noOp)
  assert.match(batchService.slice(noOp, firstWrite), /return \{ campaignId: campaign\.id[\s\S]*recycledCount: 0/u)
})

test('同一批量请求使用现有 recycle log 唯一幂等约束', () => {
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  assert.match(batchService, /userId_idempotencyKey/u)
  assert.match(batchService, /if \(existing\)/u)
  assert.match(read('prisma/schema.prisma'), /model PharmacyRecycleLog \{[\s\S]*@@unique\(\[userId, idempotencyKey\]\)/u)
})

test('一键回收使用原挂号费类型并关联现有回收流水', () => {
  const batchService = pharmacy.slice(pharmacy.indexOf('export async function recycleAllPharmacyDuplicates'), pharmacy.indexOf('type PublicCampaignRow'))
  assert.match(batchService, /action: 'PHARMACY_DUPLICATE_RECYCLE'/u)
  assert.match(batchService, /pharmacyRecycleLogId: recycleId/u)
  assert.match(batchService, /requestedAmount: plan\.rewardAmount/u)
})

test('回收页面的一键预览由同一纯规则计算器输出可回收数量和挂号费', () => {
  assert.match(pharmacy, /planPharmacyRecycleAll\(/u)
  assert.match(pharmacy, /recyclableCount: recyclePlan\.recyclableCount/u)
  assert.match(pharmacy, /recyclableReward: recyclePlan\.rewardAmount/u)
  assert.match(client, /共 \$\{data\.duplicate\.recyclableCount\} 枚可回收/u)
  assert.match(client, /可获得 \$\{formatFee\(data\.duplicate\.recyclableReward\)\} 挂号费/u)
})

test('抽取次数按当前 userId + active campaignId 的 PharmacyDraw 真实记录统计', () => {
  const pageData = pharmacy.slice(pharmacy.indexOf('export async function getPharmacyPageData'), pharmacy.indexOf('export async function getAdminPharmacyCampaigns'))
  assert.match(pageData, /userId \? prisma\.pharmacyDraw\.count\(\{ where: \{ userId, campaignId: campaign\.id \} \}\) : Promise\.resolve\(0\)/u)
  assert.doesNotMatch(pageData, /campaign\.totalDrawLimit === null \? 0 : await prisma\.pharmacyDraw\.count/u)
  assert.match(client, /本期累计抽取 \{user\.totalCount\} 次/u)
})

test('无 active campaign 返回本期计数 0；历史/预告 campaign 不进入当前统计', () => {
  const pageData = pharmacy.slice(pharmacy.indexOf('export async function getPharmacyPageData'), pharmacy.indexOf('export async function getAdminPharmacyCampaigns'))
  assert.match(pageData, /const campaign = selection\.activeCampaign/u)
  assert.match(pageData, /if \(!campaign\)[\s\S]*totalCount: 0/u)
  assert.match(pageData, /where: \{ userId, campaignId: campaign\.id \}/u)
})

test('本期抽取计数不包含回收日志，并由现有 draw 刷新返回值更新', () => {
  const pageData = pharmacy.slice(pharmacy.indexOf('export async function getPharmacyPageData'), pharmacy.indexOf('export async function getAdminPharmacyCampaigns'))
  assert.match(pageData, /prisma\.pharmacyDraw\.count\(\{ where: \{ userId, campaignId: campaign\.id \} \}\)/u)
  assert.doesNotMatch(pageData, /pharmacyRecycleLog\.count/u)
  assert.match(client, /if \(payload\.data\?\.page\) setData\(payload\.data\.page\)/u)
})

test('UI 二次确认含余药数、勋章种类数和挂号费，并支持取消', () => {
  assert.match(client, /将回收本期全部 \{recyclableCount\} 枚余药，涉及 \{recyclableTypeCount\} 种勋章，共获得 \{formatFee\(rewardAmount\)\} 挂号费/u)
  assert.match(client, /暂不回收/u)
  assert.match(client, /确认全部回收/u)
  assert.match(client, /role="dialog"[\s\S]*aria-labelledby="angel-gift-recycle-confirm-title"/u)
})

test('回收成功后使用服务端刷新页数据并提示真实到账数量', () => {
  assert.match(client, /fetch\('\/api\/angel-gift\/recycle\/all'/u)
  assert.match(client, /已回收 \$\{payload\.data\.recycledCount\} 枚余药，共获得/u)
  assert.match(client, /if \(payload\.data\?\.page\) setData\(payload\.data\.page\)/u)
})

test('Web only；无需 Prisma schema 或 migration 改动', () => {
  assert.doesNotMatch(route, /@prisma\/client/u)
  assert.match(client, /recycleAllPharmacyDuplicates|\/api\/angel-gift\/recycle\/all/u)
})
