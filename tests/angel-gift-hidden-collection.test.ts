import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { resolveVisibleSeriesCollection, type AngelGiftCollectionBadgeDefinition } from '@/lib/angel-gift-collection'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

function definition(count = 10) {
  return Array.from({ length: count }, (_, index): AngelGiftCollectionBadgeDefinition => ({
    id: `ordinary-${index + 1}`,
    name: `普通款 ${index + 1}`,
    code: `ordinary_${index + 1}`,
    imageUrl: null,
    rarity: 'COMMON',
    visibility: 'PUBLIC',
    sortOrder: index,
    isHidden: false,
  }))
}

test('隐藏款未解锁时不会出现在系列总数，普通款仍保持动态进度', () => {
  const ordinary = definition()
  const hidden: AngelGiftCollectionBadgeDefinition = { id: 'hidden-1', name: '隐藏款', code: 'hidden_1', imageUrl: null, rarity: 'LIMITED', visibility: 'PUBLIC', sortOrder: 10, isHidden: true }
  const result = resolveVisibleSeriesCollection({
    seriesId: 'campaign-1',
    seriesTitle: '测试系列',
    requiredBadges: [...ordinary, hidden],
    historicallyOwnedIds: new Set(ordinary.slice(0, 6).map((badge) => badge.id)),
    activeOwnedAt: new Map(ordinary.slice(0, 6).map((badge) => [badge.id, new Date('2026-09-17T00:00:00.000Z')])),
  })

  assert.equal(result.visibleTotalCount, 10)
  assert.equal(result.visibleOwnedCount, 6)
  assert.equal(result.collectionComplete, false)
  assert.equal(result.hiddenRevealedCount, 0)
  assert.equal(result.visibleBadges.some((badge) => badge.id === hidden.id), false)
})

test('用户获得隐藏款后按本人历史解锁，撤销当前持有不撤销解锁', () => {
  const ordinary = definition()
  const hidden: AngelGiftCollectionBadgeDefinition = { id: 'hidden-1', name: '隐藏款', code: 'hidden_1', imageUrl: null, rarity: 'LIMITED', visibility: 'PUBLIC', sortOrder: 10, isHidden: true }
  const result = resolveVisibleSeriesCollection({
    seriesId: 'campaign-1',
    seriesTitle: '测试系列',
    requiredBadges: [...ordinary, hidden],
    historicallyOwnedIds: new Set([hidden.id]),
    activeOwnedAt: new Map(),
  })

  assert.equal(result.visibleTotalCount, 11)
  assert.equal(result.hiddenRevealedCount, 1)
  assert.equal(result.visibleBadges.find((badge) => badge.id === hidden.id)?.isOwned, false)
  assert.equal(result.visibleBadges.find((badge) => badge.id === hidden.id)?.obtainedAt, null)
  assert.equal(result.collectionComplete, false)
})

test('关闭系列关系的隐藏开关后恢复普通成员语义', () => {
  const badge: AngelGiftCollectionBadgeDefinition = { id: 'member-1', name: '普通款', code: 'member_1', imageUrl: null, rarity: 'COMMON', visibility: 'PUBLIC', sortOrder: 0, isHidden: false }
  const result = resolveVisibleSeriesCollection({ seriesId: 'campaign-1', seriesTitle: '测试系列', requiredBadges: [badge] })
  assert.equal(result.visibleTotalCount, 1)
  assert.equal(result.visibleBadges[0]?.id, badge.id)
  assert.equal(result.hiddenRevealedCount, 0)
})

test('系列全收集奖励不参与要求计数，只有获得过奖励后才加入可见总数', () => {
  const ordinary = definition()
  const reward: AngelGiftCollectionBadgeDefinition = { id: 'reward-1', name: '全收集奖励', code: 'reward_1', imageUrl: null, rarity: 'LEGENDARY', visibility: 'PUBLIC', sortOrder: 99, isHidden: true, isReward: true }
  const requiredIds = new Set(ordinary.map((badge) => badge.id))
  assert.equal(requiredIds.has(reward.id), false)

  const before = resolveVisibleSeriesCollection({ seriesId: 'campaign-1', seriesTitle: '测试系列', requiredBadges: ordinary, rewardBadge: reward, historicallyOwnedIds: new Set(ordinary.map((badge) => badge.id)), activeOwnedAt: new Map(ordinary.map((badge) => [badge.id, new Date('2026-09-17T00:00:00.000Z')])) })
  assert.equal(before.visibleTotalCount, 10)
  assert.equal(before.visibleOwnedCount, 10)
  assert.equal(before.collectionComplete, true)
  assert.equal(before.collectionRewardRevealed, false)
  assert.equal(before.collectionReward, null)

  const after = resolveVisibleSeriesCollection({ seriesId: 'campaign-1', seriesTitle: '测试系列', requiredBadges: ordinary, rewardBadge: reward, historicallyOwnedIds: new Set([...requiredIds, reward.id]), activeOwnedAt: new Map([...ordinary, reward].map((badge) => [badge.id, new Date('2026-09-17T00:00:00.000Z')])) })
  assert.equal(after.visibleTotalCount, 11)
  assert.equal(after.visibleOwnedCount, 11)
  assert.equal(after.collectionComplete, true)
  assert.equal(after.collectionRewardRevealed, true)
  assert.equal(after.collectionReward?.isReward, true)
})

test('SECRET 的 Angel Gift 历史揭晓不能突破全局保密边界', () => {
  const secret: AngelGiftCollectionBadgeDefinition = { id: 'secret-1', name: '秘密款', code: 'secret_1', imageUrl: '/secret.png', rarity: 'LIMITED', visibility: 'SECRET', sortOrder: 10, isHidden: true }
  const revoked = resolveVisibleSeriesCollection({
    seriesId: 'campaign-1',
    seriesTitle: '测试系列',
    requiredBadges: [secret],
    historicallyOwnedIds: new Set([secret.id]),
    activeOwnedAt: new Map(),
  })
  assert.equal(revoked.visibleTotalCount, 0)
  assert.equal(revoked.visibleBadges.some((badge) => badge.id === secret.id), false)

  const current = resolveVisibleSeriesCollection({
    seriesId: 'campaign-1',
    seriesTitle: '测试系列',
    requiredBadges: [secret],
    historicallyOwnedIds: new Set([secret.id]),
    activeOwnedAt: new Map([[secret.id, new Date('2026-09-17T00:00:00.000Z')]]),
  })
  assert.equal(current.visibleTotalCount, 1)
  assert.equal(current.visibleBadges[0]?.id, secret.id)
})

test('Angel Gift 隐藏/全收集接入不改变开奖权重与统一发放入口', () => {
  const pharmacy = read('lib/pharmacy.ts')
  const badgeService = read('lib/badge-service.ts')
  const migration = read('prisma/migrations/20260917120000_add_angel_gift_hidden_collection/migration.sql')
  assert.match(pharmacy, /randomInt\(pool\.totalWeight\)/)
  assert.match(pharmacy, /chooseWeightedPharmacyPrize\(pool\.prizes, roll\)/)
  assert.match(badgeService, /attachAngelGiftCollectionRewards/)
  assert.match(badgeService, /grantBadgeInTransaction\(tx, grant\)/)
  assert.match(read('lib/activity-registration.ts'), /derivedGrants/)
  assert.match(read('lib/activity-lottery-fulfillment.ts'), /derivedGrants/)
  assert.match(migration, /ADD COLUMN `collectionRewardBadgeId`/)
  assert.match(migration, /ADD COLUMN `isHidden` BOOLEAN NOT NULL DEFAULT false/)
  assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/im)
})

test('后台提供隐藏款配置、全收集奖励选择与预览后确认回填', () => {
  const manager = read('app/admin/angel-gift/AngelGiftAdminManager.tsx')
  assert.match(manager, /设为隐藏款/)
  assert.match(manager, /全收集奖励勋章/)
  assert.match(manager, /collectionRewardBadgeId/)
  assert.match(manager, /previewCollectionBackfill/)
  assert.match(manager, /executeCollectionBackfill/)
  assert.match(manager, /尚未写入生产数据/)
  assert.match(read('app/api/admin/angel-gift/campaigns/[campaignId]/collection-reward/execute/route.ts'), /body\?\.confirm !== true/)
})

test('公共投影统一使用全局 visibility，Angel Gift 关系隐藏只在 Angel context 生效', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /resolveBadgeVisibility/)
  assert.doesNotMatch(service, /getUnrevealedAngelGiftBadgeIds/)
  assert.match(read('app/api/users/[userId]/public-modules/route.ts'), /resolveBadgeVisibility/)
  assert.doesNotMatch(read('app/api/users/[userId]/public-modules/route.ts'), /getUnrevealedAngelGiftBadgeIds/)
  assert.match(read('lib/activity-lottery.ts'), /神秘勋章/)
  assert.match(read('lib/activity-lottery.ts'), /resolveBadgeVisibility/)
  assert.match(read('lib/guess-song-duel-service.ts'), /visibility: \{ not: 'SECRET' \}/)
  assert.match(read('lib/guess-song-duel-service.ts'), /isHidden: true/)
  assert.match(read('lib/guess-song-duel-service.ts'), /resolveBadgeVisibility/)
  assert.match(read('lib/angel-gift-collection.ts'), /userBadgeSource\.findMany\(\{ where: collectionHistoryWhere/)
  assert.match(read('lib/angel-gift-collection.ts'), /grantKey: `angel-gift-collection:\$\{campaignId\}`/)
})
