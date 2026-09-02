import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BADGE_ADMIN_RULE_TYPES, BADGE_RULE_REGISTRY, BADGE_RULE_TYPES_WITH_SPECIAL, parseBadgeRuleInput } from '@/lib/badge-rules'
import { BADGE_PHASE3_MAX_DEPTH, MAX_BADGE_SHOWCASE_SLOTS } from '@/lib/badge-phase3'

const read = (path: string) => readFileSync(path, 'utf8')

test('Phase 3 migration follows Phase 2 and only adds compatible structures', () => {
  const migrationPath = 'prisma/migrations/20260822200000_add_badge_phase3_honor_showcase/migration.sql'
  const migration = read(migrationPath)
  assert.ok('20260822200000_add_badge_phase3_honor_showcase' > '20260822160000_add_badge_phase2_collection_system')
  assert.match(migration, /ADD COLUMN `announceOnGrant` BOOLEAN NOT NULL DEFAULT false/)
  assert.match(migration, /ADD COLUMN `countsTowardSeriesCompletion` BOOLEAN NOT NULL DEFAULT true/)
  assert.match(migration, /ADD COLUMN `showBadgeActivity` BOOLEAN NOT NULL DEFAULT true/)
  assert.match(migration, /CREATE TABLE `UserBadgeShowcase`/)
  assert.match(migration, /MODIFY COLUMN `threshold` INT NULL/)
  assert.match(migration, /ON DELETE SET NULL/)
  assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE|UPDATE `Badge`|UPDATE `UserBadge`|equippedBadgeId/i)
})

test('showcase schema has six-slot-safe uniqueness and preserves ownership history', () => {
  const schema = read('prisma/schema.prisma')
  assert.equal(MAX_BADGE_SHOWCASE_SLOTS, 6)
  assert.match(schema, /model UserBadgeShowcase\s*\{[\s\S]*?slot\s+Int[\s\S]*?@@unique\(\[userId, badgeId\]\)[\s\S]*?@@unique\(\[userId, slot\]\)/)
  assert.match(schema, /UserBadgeShowcase\s+UserBadgeShowcase\[\]/)
  assert.match(schema, /UserBadgeShowcase_badgeId_idx|@@index\(\[badgeId\]\)/)
  assert.match(read('lib/badge-service.ts'), /normalized\.length > 6/)
  assert.match(read('lib/badge-service.ts'), /updateUserBadgeShowcase[\s\S]*?deleteMany\(\{ where: \{ userId \} \}\)/)
  assert.match(read('lib/badge-service.ts'), /UserBadgeShowcase[\s\S]*?Badge: \{ isEnabled: true, isActive: true \}/)
})

test('series reward relation is nullable and deleting a series only ungroups badges', () => {
  const schema = read('prisma/schema.prisma')
  const seriesService = read('lib/badge-series.ts')
  const migration = read('prisma/migrations/20260822200000_add_badge_phase3_honor_showcase/migration.sql')
  assert.match(schema, /completionRewardBadgeId\s+String\?/)
  assert.match(schema, /CompletionRewardBadge\s+Badge\?[^\n]*onDelete: SetNull/)
  assert.match(migration, /BadgeSeries_completionRewardBadgeId_fkey[\s\S]*ON DELETE SET NULL/)
  assert.match(seriesService, /updateMany\(\{ where: \{ seriesId: input\.seriesId \}, data: \{ seriesId: null \} \}\)/)
  assert.doesNotMatch(seriesService, /tx\.userBadge\.delete|tx\.badge\.delete/)
})

test('series completion is a registry rule but is never an admin numeric rule', () => {
  assert.equal(BADGE_RULE_TYPES_WITH_SPECIAL.length, 18)
  assert.equal(BADGE_ADMIN_RULE_TYPES.length, 17)
  assert.equal(BADGE_RULE_REGISTRY.BADGE_SERIES_COMPLETE.seriesCompletion, true)
  const parsed = parseBadgeRuleInput({
    ruleType: 'BADGE_SERIES_COMPLETE',
    operator: 'GTE',
    threshold: null,
    configJson: { seriesId: 'series_1' },
  })
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.rule?.threshold, null)
  assert.deepEqual(parsed.rule?.configJson, { seriesId: 'series_1' })
  assert.match(parseBadgeRuleInput({ ruleType: 'BADGE_SERIES_COMPLETE', configJson: {} }).error || '', /系列标识无效/)
  assert.match(parseBadgeRuleInput({ ruleType: 'BADGE_SERIES_COMPLETE', configJson: { seriesId: 'series_1' }, threshold: 1 }).error || '', /不需要数值阈值/)
  assert.match(parseBadgeRuleInput({ ruleType: 'POST_COUNT', operator: 'GTE', threshold: null }).error || '', /规则阈值必须是/)
})

test('series reward configuration validates enabled AUTO badges and prevents a completion loop', () => {
  const service = read('lib/badge-series.ts')
  assert.match(service, /reward\.grantType !== 'AUTO'/)
  assert.match(service, /reward\.seriesId === seriesId && reward\.countsTowardSeriesCompletion/)
  assert.match(service, /countsTowardSeriesCompletion: false/)
  assert.match(service, /BADGE_SERIES_COMPLETE[\s\S]*threshold: null/)
  assert.match(service, /currentRule\.ruleType !== 'BADGE_SERIES_COMPLETE'/)
  assert.match(read('lib/badge-phase3.ts'), /id: \{ not: series\.completionRewardBadgeId \}/)
  assert.match(read('lib/badge-phase3.ts'), /BADGE_PHASE3_MAX_DEPTH/)
  assert.equal(BADGE_PHASE3_MAX_DEPTH, 5)
})

test('grant effects batch notifications and never notify already-owned records', () => {
  const service = read('lib/badge-service.ts')
  const phase3 = read('lib/badge-phase3.ts')
  const engine = read('lib/badge-rule-engine.ts')
  assert.doesNotMatch(phase3, /from ['"]node:crypto['"]/)
  assert.match(service, /if \(result\.created && !input\.deferPhase3Effects\)/)
  assert.match(engine, /newlyGranted/)
  assert.match(engine, /regularGrants/)
  assert.match(engine, /same-day zodiac \+ birthday grant produces two/)
  assert.match(phase3, /badges\.length === 1 \? '🎖 获得新勋章' : `🎖 获得 \$\{badges\.length\} 枚新勋章`/)
  assert.match(phase3, /type: 'BADGE'/)
  assert.match(phase3, /grants\.map\(\(grant\) => grant\.recordId\)/)
  assert.match(service, /alreadyOwned: true/)
})

test('tier upgrade text is informational and does not equip a badge', () => {
  const phase3 = read('lib/badge-phase3.ts')
  assert.match(phase3, /下一等级：/)
  assert.match(phase3, /已完成该成长系列最高等级/)
  assert.match(phase3, /ownedTierRows/)
  assert.match(phase3, /highestOwnedTier/)
  assert.doesNotMatch(phase3, /equippedBadgeId[\s\S]*update|update\([\s\S]*equippedBadgeId/)
})

test('series completion checks only affected series and applies bounded recursion', () => {
  const phase3 = read('lib/badge-phase3.ts')
  assert.match(phase3, /badge\.Series/)
  assert.match(phase3, /visitedBadgeIds/)
  assert.match(phase3, /checkedSeriesIds/)
  assert.match(phase3, /state\.visitedSeriesIds\.has\(series\.id\)/)
  assert.match(phase3, /state\.depth >= BADGE_PHASE3_MAX_DEPTH/)
  assert.match(phase3, /badge\.series\.max-depth/)
  assert.match(phase3, /state\.grants\.push\(\.\.\.nextRewards\)/)
  assert.match(phase3, /sourceType: 'AUTO_RULE'/)
  assert.match(phase3, /requiredBadgeIds\.length/)
})

test('profile payload keeps recent and showcase bounded and avoids full progress on profile modules', () => {
  const service = read('lib/badge-service.ts')
  const route = read('app/api/users/[userId]/badges/route.ts')
  assert.match(service, /Lightweight profile payload: it never loads the full catalog or computes live progress/)
  assert.match(service, /take: 5/)
  assert.match(service, /showcaseRows/)
  assert.match(service, /equippedOwnership/)
  assert.match(service, /const equippedIsVisible = Boolean\(target\.EquippedBadge && equippedOwnership/)
  assert.match(route, /preview[\s\S]*getBadgeProfileSummary/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /最多选择 6 枚已获得勋章/)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /最近获得/)
})

test('public badge surfaces keep SECRET absent and only expose obtained hidden badges', () => {
  const service = read('lib/badge-service.ts')
  const phase3 = read('lib/badge-phase3.ts')
  assert.match(service, /if \(badge\.visibility === 'SECRET'\) return \[\]/)
  assert.match(service, /visibility: \{ not: 'SECRET'/)
  assert.match(phase3, /visibility: \{ not: 'SECRET' \}/)
  assert.match(phase3, /badge\.visibility !== 'SECRET'/)
  assert.match(read('lib/badge-share-card.ts'), /只能分享自己已经获得|where: \{ userId_badgeId/)
})

test('share card is rate-limited, server-owned, escaped and bounded', () => {
  const route = read('app/api/users/me/badges/[badgeId]/share-card/route.ts')
  const card = read('lib/badge-share-card.ts')
  assert.match(route, /rejectInvalidRequestOrigin/)
  assert.match(route, /limit: 10/)
  assert.match(card, /escapePango/)
  assert.match(card, /buffer\.length > 2 \* 1024 \* 1024/)
  assert.match(card, /AbortSignal\.timeout\(3000\)/)
  assert.match(card, /getBadgeOwnershipStats/)
})

test('public rare activity respects explicit badge flag, SECRET protection and user privacy switch', () => {
  const phase3 = read('lib/badge-phase3.ts')
  const activityRoute = read('app/api/friends/activity/route.ts')
  const profileRoute = read('app/api/users/me/route.ts')
  assert.match(phase3, /announceOnGrant && badge\.visibility !== 'SECRET'/)
  assert.match(phase3, /showBadgeActivity/)
  assert.match(activityRoute, /'BADGE'/)
  assert.match(profileRoute, /showBadgeActivity/)
  assert.match(read('app/profile/ProfileSettingsForm.tsx'), /勋章获得动态/)
})

test('showcase mutations are authenticated, origin-protected and transactional', () => {
  const route = read('app/api/users/me/badge-showcase/route.ts')
  const service = read('lib/badge-service.ts')
  assert.match(route, /rejectInvalidRequestOrigin/)
  assert.match(route, /requireUser\(\)/)
  assert.match(route, /Array\.isArray\(body\?\.badgeIds\)/)
  assert.match(service, /return prisma\.\$transaction\(async \(tx\) =>/)
  assert.match(service, /owned\.length !== normalized\.length/)
  assert.match(service, /NOT_OWNED/)
})

test('series completion preview reports the real eligible-and-unowned set', () => {
  const phase3 = read('lib/badge-phase3.ts')
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(phase3, /eligibleIds\.length - pending/)
  assert.match(phase3, /badgeId: rewardBadgeId/)
  assert.match(engine, /getSeriesCompletionPreview\(seriesId, badgeId\)/)
  assert.doesNotMatch(engine, /pendingCount: eligibleCount - ownedCount/)
})

test('Phase 3 grant pipeline retains existing wearable and historical ownership semantics', () => {
  const service = read('lib/badge-service.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(service, /userBadgeShowcase\.deleteMany\(\{ where: \{ badgeId \} \}\)/)
  assert.match(service, /equippedBadgeId: null/)
  assert.match(service, /userBadge\.create/)
  assert.match(service, /userBadgeShowcase\.deleteMany\(\{ where: \{ userId, badgeId \} \}\)/)
  assert.match(schema, /model UserBadgeShowcase[\s\S]+?User\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/)
  assert.doesNotMatch(service, /userBadge\.deleteMany\(\{ where: \{ userId, badgeId/)
})
