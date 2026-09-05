import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { parseBadgeRuleInput } from '@/lib/badge-rules'
import { planConcertBadgeAwards, type ConcertBadgeDefinition } from '@/lib/concert-badge'

const read = (path: string) => readFileSync(path, 'utf8')

test('admin form hides immutable identifiers and server generates badge/series codes', () => {
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  assert.doesNotMatch(manager, />唯一 code</)
  assert.doesNotMatch(manager, />Tier 系列编码</)
  assert.doesNotMatch(manager, />Tier 等级</)
  assert.match(manager, /勋章类型/)
  assert.match(manager, /等级 \/ 阶段/)
  assert.match(read('app/api/admin/badges/route.ts'), /generatedCode.*randomUUID/)
  assert.match(read('lib/badge-series.ts'), /SERIES_.*randomUUID/)
})

test('code and slug supplied by clients are ignored by the shared parser', () => {
  const parsed = parseBadgeDefinition({ name: '管理员勋章', code: 'attacker-code', slug: 'javascript-url', grantType: 'MANUAL' })
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.data?.code, undefined)
  assert.equal(parsed.data?.slug, undefined)
})

test('targeted concert rules require controlled IDs and no fake numeric threshold', () => {
  const show = parseBadgeRuleInput({ ruleType: 'CONCERT_SHOW_ATTENDED', configJson: { concertId: 'show_123' }, threshold: null })
  const tour = parseBadgeRuleInput({ ruleType: 'CONCERT_TOUR_ATTENDED', configJson: { tourId: 'tour_123' }, threshold: null })
  assert.equal(show.rule?.configJson && (show.rule.configJson as { concertId: string }).concertId, 'show_123')
  assert.equal(tour.rule?.configJson && (tour.rule.configJson as { tourId: string }).tourId, 'tour_123')
  assert.match(parseBadgeRuleInput({ ruleType: 'CONCERT_SHOW_ATTENDED', configJson: {} }).error || '', /请选择/)
  assert.match(parseBadgeRuleInput({ ruleType: 'CONCERT_TOUR_ATTENDED', configJson: { tourId: 'tour_123' }, threshold: 1 }).error || '', /不需要填写数量/)
})

function definition(overrides: Partial<ConcertBadgeDefinition>): ConcertBadgeDefinition {
  return {
    id: 'badge',
    code: 'badge',
    slug: 'badge',
    name: '演唱会勋章',
    musicTourId: null,
    ruleId: 'rule',
    operator: 'GTE',
    threshold: null,
    ruleType: 'CONCERT_SHOW_ATTENDED',
    targetConcertId: null,
    targetTourId: null,
    ...overrides,
  }
}

test('My Live facts match a specific show and a stable tour ID', () => {
  const facts = [
    { concertId: 'show_a', tourId: 'tour_a', createdAt: new Date('2024-01-01T00:00:00Z') },
    { concertId: 'show_b', tourId: 'tour_b', createdAt: new Date('2024-02-01T00:00:00Z') },
  ]
  const awards = planConcertBadgeAwards({
    attendances: facts,
    badges: [
      definition({ id: 'show_badge', targetConcertId: 'show_a' }),
      definition({ id: 'tour_badge', ruleType: 'CONCERT_TOUR_ATTENDED', targetTourId: 'tour_b' }),
      definition({ id: 'miss', targetConcertId: 'show_missing' }),
    ],
  })
  assert.deepEqual(awards.map((award) => award.badge.id), ['show_badge', 'tour_badge'])
})

test('targeted concert reconciliation remains additive and idempotent', () => {
  const badge = definition({ id: 'show_badge', targetConcertId: 'show_a' })
  const facts = [{ concertId: 'show_a', tourId: 'tour_a', createdAt: new Date('2024-01-01T00:00:00Z') }]
  assert.equal(planConcertBadgeAwards({ attendances: facts, badges: [badge] }).length, 1)
  assert.equal(planConcertBadgeAwards({ attendances: facts, badges: [badge], ownedBadgeIds: new Set(['show_badge']) }).length, 0)
  const schema = read('prisma/schema.prisma')
  const userBadge = schema.slice(schema.indexOf('model UserBadge'), schema.indexOf('model UserBadgeShowcase'))
  assert.match(userBadge, /activeKey\s+String\?\s+@unique/)
  assert.doesNotMatch(userBadge, /@@unique\(\[userId, badgeId\]\)/)
})

test('admin image flow previews PNG/WebP and never converts alpha images to JPEG', () => {
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  const upload = read('app/api/admin/badges/upload/route.ts')
  assert.match(manager, /accept="image\/png,image\/webp/)
  assert.match(manager, /object-contain/)
  assert.match(upload, /image\/png/)
  assert.match(upload, /image\/webp/)
  assert.doesNotMatch(upload, /\.jpeg\(|image\/jpeg/)
})

test('admin restores the controlled visual effect selector and live BadgeImage preview', () => {
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  const labels = read('lib/badge-types.ts')
  assert.match(manager, /展示效果/)
  assert.match(manager, /闪光效果<select value=\{draft\.effectType\}/)
  assert.equal((manager.match(/闪光效果<select/g) || []).length, 1)
  assert.match(manager, /<BadgeImage badge=\{\{ name: draft\.name[\s\S]*effectType: draft\.effectType/)
  assert.match(labels, /NONE:\s*'无效果'/)
  assert.match(labels, /SHINE:\s*'闪耀（扫光）'/)
  assert.doesNotMatch(manager, />NONE<|>SHINE<|>GLOW<|>SPARKLE</)
})

test('visual effect create and partial edit preserve controlled database values', () => {
  const created = parseBadgeDefinition({ name: '闪耀勋章', grantType: 'MANUAL', effectType: 'SHINE' })
  const partial = parseBadgeDefinition({ description: '只更新简介' }, true)
  assert.equal(created.data?.effectType, 'SHINE')
  assert.equal(partial.data?.effectType, undefined)
  assert.match(parseBadgeDefinition({ name: '非法效果', grantType: 'MANUAL', effectType: 'CSS_CLASS' }).error || '', /动画效果无效/)
})

test('all public badge collections reuse BadgeImage and reduced motion disables effect animation', () => {
  for (const path of [
    'components/BadgeExhibitionHall.tsx',
    'components/BadgeCollectionPanel.tsx',
    'components/BadgeMiniShowcase.tsx',
    'components/BadgeSeriesDetail.tsx',
  ]) assert.match(read(path), /BadgeImage/)
  const component = read('components/UserDisplayName.tsx')
  const css = read('app/globals.css')
  assert.match(component, /object-fit:contain|user-badge-image/)
  assert.match(css, /\.user-badge-image[\s\S]*object-fit:contain/)
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*badge-effect-shine[\s\S]*animation:none/)
})

test('new rule enum migration only extends BadgeRuleType', () => {
  const migration = read('prisma/migrations/20260824180000_add_targeted_concert_badge_rules/migration.sql')
  assert.match(migration, /CONCERT_SHOW_ATTENDED/)
  assert.match(migration, /CONCERT_TOUR_ATTENDED/)
  assert.doesNotMatch(migration, /DELETE|TRUNCATE|DROP TABLE|ALTER TABLE `Badge`/i)
})
