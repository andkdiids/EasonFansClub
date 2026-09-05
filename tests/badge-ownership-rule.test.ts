import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  describeBadgeOwnershipRule,
  hasCurrentBadgeOwnership,
  matchBadgeOwnershipConfig,
  normalizeBadgeOwnershipRuleConfig,
  shouldRetainBadgeFromSources,
} from '@/lib/badge-ownership-config'
import { hasBadgeOwnershipCycle } from '@/lib/badge-ownership'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { BADGE_RULE_REGISTRY, parseBadgeRuleInput } from '@/lib/badge-rules'

const read = (path: string) => readFileSync(path, 'utf8')

test('BADGE_OWNERSHIP is a first-class controlled rule with the exact Chinese label', () => {
  assert.equal(BADGE_RULE_REGISTRY.BADGE_OWNERSHIP.label, '拥有指定勋章')
  const parsed = parseBadgeRuleInput({
    ruleType: 'BADGE_OWNERSHIP',
    operator: 'GTE',
    threshold: null,
    configJson: { badgeIds: ['A', 'A', 'B'], matchMode: 'ALL' },
  })
  assert.equal(parsed.error, undefined)
  assert.deepEqual(parsed.rule?.configJson, { badgeIds: ['A', 'B'], matchMode: 'ALL' })
  assert.equal(parsed.rule?.threshold, null)
  assert.equal(parseBadgeDefinition({ name: '组合勋章', grantType: 'AUTO', rule: { ruleType: 'BADGE_OWNERSHIP', configJson: { badgeIds: ['A'], matchMode: 'ALL' } } }).error, undefined)
})

test('ALL, ANY and AT_LEAST use current ownership sets and reject empty or invalid N', () => {
  const all = { badgeIds: ['A', 'B', 'C'], matchMode: 'ALL' as const }
  const any = { badgeIds: ['A', 'B', 'C'], matchMode: 'ANY' as const }
  const atLeast = { badgeIds: ['A', 'B', 'C', 'D'], matchMode: 'AT_LEAST' as const, minimumCount: 3 }
  assert.equal(matchBadgeOwnershipConfig(['A'], all), false)
  assert.equal(matchBadgeOwnershipConfig(['A', 'B'], all), false)
  assert.equal(matchBadgeOwnershipConfig(['A', 'B', 'C'], all), true)
  assert.equal(matchBadgeOwnershipConfig(['B'], any), true)
  assert.equal(matchBadgeOwnershipConfig(['A'], atLeast), false)
  assert.equal(matchBadgeOwnershipConfig(['A', 'B'], { ...atLeast, minimumCount: 2 }), true)
  assert.equal(normalizeBadgeOwnershipRuleConfig({ badgeIds: [], matchMode: 'ALL' }).config, undefined)
  assert.match(normalizeBadgeOwnershipRuleConfig({ badgeIds: ['A', 'B'], matchMode: 'AT_LEAST', minimumCount: 0 }).error || '', /1 到 2/)
  assert.match(normalizeBadgeOwnershipRuleConfig({ badgeIds: ['A', 'B'], matchMode: 'AT_LEAST', minimumCount: 3 }).error || '', /1 到 2/)
})

test('expired and revoked prerequisite badges do not count as currently owned', () => {
  const now = new Date('2026-09-05T12:00:00.000Z')
  assert.equal(hasCurrentBadgeOwnership({ status: 'ACTIVE', expiresAt: '2026-09-05T12:00:00.001Z' }, now), true)
  assert.equal(hasCurrentBadgeOwnership({ status: 'ACTIVE', expiresAt: now }, now), false)
  assert.equal(hasCurrentBadgeOwnership({ status: 'EXPIRED', expiresAt: null }, now), false)
  assert.equal(hasCurrentBadgeOwnership({ status: 'REVOKED', expiresAt: null }, now), false)
  assert.equal(matchBadgeOwnershipConfig(['A', 'B'], { badgeIds: ['A', 'B', 'C'], matchMode: 'ALL' }), false)
  assert.equal(describeBadgeOwnershipRule({ badgeIds: ['A', 'B', 'C'], badgeNames: ['浮夸', '防不胜防', '黑择明'], matchMode: 'ALL' }), '集齐「浮夸」、「防不胜防」、「黑择明」后获得')
  assert.equal(describeBadgeOwnershipRule({ badgeIds: ['A', 'B', 'C'], badgeNames: ['A', 'B', 'C'], matchMode: 'ANY' }), '获得「A」「B」「C」中的任意一枚后获得')
  assert.equal(describeBadgeOwnershipRule({ badgeIds: ['A', 'B', 'C', 'D', 'E'], matchMode: 'AT_LEAST', minimumCount: 3 }), '获得指定勋章中的任意 3 枚后获得')
})

test('manual and independent sources protect the aggregate while ownership-derived source can be revoked', () => {
  const now = new Date('2026-09-05T12:00:00.000Z')
  assert.equal(shouldRetainBadgeFromSources([
    { sourceType: 'AUTO_RULE', sourceId: 'ownership-rule', isActive: false, expiresAt: now },
    { sourceType: 'ADMIN_GRANT', sourceId: 'admin-op', isActive: true, expiresAt: null },
  ], now), true)
  assert.equal(shouldRetainBadgeFromSources([
    { sourceType: 'AUTO_RULE', sourceId: 'ownership-rule', isActive: false, expiresAt: now },
    { sourceType: 'ACTIVITY_VERIFICATION', sourceId: 'activity-1', isActive: false, expiresAt: now },
  ], now), false)
})

test('self and multi-level circular dependency graphs are rejected before runtime evaluation', () => {
  assert.equal(hasBadgeOwnershipCycle(new Map([['A', ['A']]])), true)
  assert.equal(hasBadgeOwnershipCycle(new Map([['A', ['B']], ['B', ['A']]])), true)
  assert.equal(hasBadgeOwnershipCycle(new Map([['A', ['B']], ['B', ['C']], ['C', ['A']]])), true)
  assert.equal(hasBadgeOwnershipCycle(new Map([['A', ['B']], ['B', []], ['C', ['B']]])), false)
  assert.match(parseBadgeRuleInput({ ruleType: 'BADGE_OWNERSHIP', configJson: { badgeIds: [], matchMode: 'ALL' } }).error || '', /至少需要选择一枚/)
})

test('admin configuration, dependency indexing, active-only recheck, source-aware revoke and batch backfill are wired together', () => {
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  const createRoute = read('app/api/admin/badges/route.ts')
  const updateRoute = read('app/api/admin/badges/[badgeId]/route.ts')
  const ownership = read('lib/badge-ownership.ts')
  const service = read('lib/badge-service.ts')
  const expiration = read('lib/badge-expiration.ts')
  const migration = read('prisma/migrations/20260905100000_add_badge_ownership_rules/migration.sql')
  assert.match(manager, /搜索勋章名称或 code/)
  assert.match(manager, /BADGE_RARITY_LABELS\[option\.rarity\]/)
  assert.match(manager, /option\.iconUrl \? <img/)
  assert.match(manager, /至少拥有 N 个/)
  assert.match(manager, /option.id !== draft.id/)
  assert.match(createRoute, /validateBadgeOwnershipRule/)
  assert.match(updateRoute, /validateBadgeOwnershipRule/)
  assert.match(ownership, /where: { sourceBadgeId }/)
  assert.match(ownership, /activeUserBadgeWhere\(now\)/)
  assert.match(ownership, /visitedBadgeIds/)
  assert.match(ownership, /revokeBadgeAcquisitionSource/)
  assert.match(ownership, /take: input.batchSize \+ 1/)
  assert.match(read('lib/badge-rule-engine.ts'), /getBadgeOwnershipRuleStats/)
  assert.match(service, /userBadgeSource.upsert/)
  assert.match(service, /sourceType === 'ADMIN_GRANT' \|\| sourceType === 'ADMIN_BACKFILL'/)
  assert.match(service, /userBadgeSource.updateMany/)
  assert.match(expiration, /userBadgeSource.findMany/)
  assert.match(expiration, /triggerBadgeOwnershipRecheck/)
  assert.match(migration, /CREATE TABLE `BadgeRuleDependency`/)
  assert.match(migration, /CREATE TABLE `UserBadgeSource`/)
  assert.match(migration, /INSERT INTO `UserBadgeSource`/)
})

test('all existing grant families still have a post-commit ownership recheck path', () => {
  assert.match(read('lib/badge-phase3.ts'), /triggerBadgeOwnershipRecheck\(input\.userId, grant\.badgeId\)/)
  assert.match(read('lib/activity-registration.ts'), /activity.badge-reward.ownership-recheck/)
  assert.match(read('lib/activity-registration.ts'), /activities.auto-check-in.ownership-recheck/)
  assert.match(read('lib/activity-lottery-fulfillment.ts'), /activity-lottery.badge-ownership-recheck/)
  assert.match(read('lib/material-redemptions.ts'), /material-redemption.activity-badge-reward/)
  assert.match(read('lib/badge-service.ts'), /badge.revoke.ownership-recheck/)
})

test('acquisition copy is resolved through the existing rule description path', () => {
  assert.match(read('lib/badge-service.ts'), /generateBadgeAcquisitionDescription\(rule\.ruleType as SupportedBadgeRuleType, rule\.threshold, rule\.configJson\)/)
  assert.match(read('lib/badge-rules.ts'), /label: '拥有指定勋章'/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /获取方式：\{displayBadge.acquisitionDescription\}/)
})
