import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BADGE_RETENTION_POLICY_LABELS,
  BADGE_RETENTION_POLICY_DESCRIPTIONS,
  BADGE_RULE_REGISTRY,
  getDefaultBadgeRetentionPolicy,
  normalizeBadgeRetentionPolicy,
  parseBadgeRuleInput,
  resolveBadgeRetentionPolicy,
  supportsBadgeRetentionPolicy,
} from '@/lib/badge-rules'

const read = (path: string) => readFileSync(path, 'utf8')

test('数据模型提供 BadgeRetentionPolicy 枚举与规则可空保留策略列', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /enum BadgeRetentionPolicy\s*\{[\s\S]*?PERMANENT_AFTER_GRANT[\s\S]*?RETAIN_WHILE_ELIGIBLE/)
  assert.match(schema, /model BadgeRule\s*\{[\s\S]*?retentionPolicy\s+BadgeRetentionPolicy\?/)
  assert.match(schema, /retentionPolicy\s+BadgeRetentionPolicy\?[\s\S]*?createdAt/)
})

test('迁移只加可空列（NULL=继承规则类型默认），不回写任何历史记录', () => {
  const migration = read('prisma/migrations/20260906010000_add_badge_retention_policy/migration.sql')
  assert.match(migration, /ADD COLUMN `retentionPolicy` ENUM\('PERMANENT_AFTER_GRANT', 'RETAIN_WHILE_ELIGIBLE'\) NULL/)
  assert.doesNotMatch(migration, /UPDATE `Badge`|UPDATE `BadgeRule`|UPDATE `UserBadge`|DELETE FROM|DROP TABLE|DEFAULT 'PERMANENT_AFTER_GRANT'/i)
})

test('规则类型回收能力标记只对可重算的规则开放', () => {
  const expectTrue = new Set(['POST_COUNT', 'CHECKIN_STREAK', 'GUESS_SONG_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED', 'RATING_COUNT', 'ACTIVITY_PARTICIPATION', 'BIRTHDAY_ZODIAC', 'BIRTHDAY_TODAY', 'BADGE_SERIES_COMPLETE', 'BADGE_OWNERSHIP'])
  const expectFalse = new Set(['FEATURED_POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'ACCOUNT_AGE_DAYS', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK'])
  // BADGE_SERIES_COMPLETE 不在 BADGE_RULE_TYPES（后台不可选）但仍注册在 registry。
  const registryKeys = new Set(Object.keys(BADGE_RULE_REGISTRY))
  for (const ruleType of registryKeys) {
    assert.equal(typeof BADGE_RULE_REGISTRY[ruleType as keyof typeof BADGE_RULE_REGISTRY].supportsRetentionWhileEligible, 'boolean', ruleType)
    assert.equal(expectTrue.has(ruleType), !expectFalse.has(ruleType), `${ruleType} 必须且只能出现在一个集合中`)
    const expected = expectTrue.has(ruleType)
    assert.equal(supportsBadgeRetentionPolicy(ruleType as Parameters<typeof supportsBadgeRetentionPolicy>[0]), expected, ruleType)
  }
  // 两个集合必须完整覆盖注册表，防止未来加类型时漏标。
  assert.equal(expectTrue.size + expectFalse.size, registryKeys.size)
})

test('默认策略保持现状：除 BADGE_OWNERSHIP 外全部永久保留', () => {
  for (const ruleType of Object.keys(BADGE_RULE_REGISTRY)) {
    const expected = ruleType === 'BADGE_OWNERSHIP' ? 'RETAIN_WHILE_ELIGIBLE' : 'PERMANENT_AFTER_GRANT'
    assert.equal(getDefaultBadgeRetentionPolicy(ruleType as Parameters<typeof getDefaultBadgeRetentionPolicy>[0]), expected, ruleType)
  }
})

test('解析/归一化：空值继承默认，RETAIN 只能用于支持持续资格的类型', () => {
  for (const empty of [undefined, null, '', '  ']) {
    const parsed = parseBadgeRuleInput({ ruleType: 'CHECKIN_STREAK', operator: 'GTE', threshold: '30', retentionPolicy: empty })
    assert.equal(parsed.error, undefined)
    assert.equal(parsed.rule?.retentionPolicy, null)
  }
  const allowed = parseBadgeRuleInput({ ruleType: 'CHECKIN_STREAK', operator: 'GTE', threshold: '30', retentionPolicy: 'retain_while_eligible' })
  assert.equal(allowed.error, undefined)
  assert.equal(allowed.rule?.retentionPolicy, 'RETAIN_WHILE_ELIGIBLE')
  const ownership = parseBadgeRuleInput({ ruleType: 'BADGE_OWNERSHIP', configJson: { badgeIds: ['A'], matchMode: 'ALL' }, retentionPolicy: 'RETAIN_WHILE_ELIGIBLE' })
  assert.equal(ownership.error, undefined)
  assert.equal(ownership.rule?.retentionPolicy, 'RETAIN_WHILE_ELIGIBLE')
  const rejected = parseBadgeRuleInput({ ruleType: 'FEATURED_POST_COUNT', operator: 'GTE', threshold: '3', retentionPolicy: 'RETAIN_WHILE_ELIGIBLE' })
  assert.match(rejected.error || '', /不能按资格持续满足回收/)
  assert.equal(parseBadgeRuleInput({ ruleType: 'CHECKIN_STREAK', operator: 'GTE', threshold: '30', retentionPolicy: 'NOT_A_POLICY' }).error, '资格保持方式无效')
  assert.equal(normalizeBadgeRetentionPolicy(123, 'CHECKIN_STREAK').error, '资格保持方式无效')
})

test('解析时保留策略会被携带到所有规则分支，包括生日/系列/演唱会目标', () => {
  const cases: Array<{ input: Record<string, unknown> }> = [
    { input: { ruleType: 'BIRTHDAY_TODAY', retentionPolicy: 'RETAIN_WHILE_ELIGIBLE' } },
    { input: { ruleType: 'BADGE_SERIES_COMPLETE', configJson: { seriesId: 'S1' }, retentionPolicy: 'RETAIN_WHILE_ELIGIBLE' } },
    { input: { ruleType: 'CONCERT_SHOW_ATTENDED', configJson: { concertId: 'C1' }, retentionPolicy: 'RETAIN_WHILE_ELIGIBLE' } },
  ]
  for (const { input } of cases) {
    const parsed = parseBadgeRuleInput(input)
    assert.equal(parsed.error, undefined)
    assert.equal(parsed.rule?.retentionPolicy, 'RETAIN_WHILE_ELIGIBLE')
  }
})

test('resolveBadgeRetentionPolicy：NULL 继承类型默认，显式值优先生效', () => {
  assert.equal(resolveBadgeRetentionPolicy({ ruleType: 'CHECKIN_STREAK', retentionPolicy: null }), 'PERMANENT_AFTER_GRANT')
  assert.equal(resolveBadgeRetentionPolicy({ ruleType: 'BADGE_OWNERSHIP', retentionPolicy: null }), 'RETAIN_WHILE_ELIGIBLE')
  assert.equal(resolveBadgeRetentionPolicy({ ruleType: 'BADGE_OWNERSHIP', retentionPolicy: 'PERMANENT_AFTER_GRANT' }), 'PERMANENT_AFTER_GRANT')
  assert.equal(resolveBadgeRetentionPolicy({ ruleType: 'CHECKIN_STREAK', retentionPolicy: 'RETAIN_WHILE_ELIGIBLE' }), 'RETAIN_WHILE_ELIGIBLE')
  assert.ok(BADGE_RETENTION_POLICY_LABELS.PERMANENT_AFTER_GRANT)
  assert.ok(BADGE_RETENTION_POLICY_DESCRIPTIONS.RETAIN_WHILE_ELIGIBLE)
})

test('保留引擎只按来源回收自动来源，并带三重守卫（类型能力/策略/限定绝版）', () => {
  const engine = read('lib/badge-retention.ts')
  assert.match(engine, /supportsBadgeRetentionPolicy\(rule\.ruleType\)/)
  assert.match(engine, /resolveBadgeRetentionPolicy\(rule\) !== 'RETAIN_WHILE_ELIGIBLE'/)
  assert.match(engine, /availability === 'ENDED' \|\| availability === 'UPCOMING'/)
  assert.match(engine, /governedSourceTypes\(rule\.ruleType\)/)
  assert.match(engine, /isActive: true, sourceType: \{ in: \[\.\.\.sourceTypes\] \}/)
  assert.match(engine, /revokeBadgeAcquisitionSource/)
  // 不出现全库扫描：来源查询必须限定 userId + badgeId。
  assert.doesNotMatch(engine, /userBadgeSource\.findMany\(\{\s*where:\s*\{\s*(isActive|sourceType)/)
})

test('所有权链式重算遵循规则保留策略：仅 RETAIN_WHILE_ELIGIBLE 才回收依赖勋章', () => {
  const ownership = read('lib/badge-ownership.ts')
  assert.match(ownership, /import \{ resolveBadgeRetentionPolicy/)
  assert.match(ownership, /retentionPolicy: true,/)
  assert.match(ownership, /resolveBadgeRetentionPolicy\(\{ ruleType: 'BADGE_OWNERSHIP', retentionPolicy:/)
  assert.match(ownership, /if \(retentionPolicy !== 'RETAIN_WHILE_ELIGIBLE'\) continue/)
})

test('事件评估先授予后复核持续资格；补签成功路径触发勋章事件', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /await import\('@\/lib\/badge-retention'\)/)
  assert.match(engine, /await evaluateBadgeRetentionForUser\(userId, \{ ruleTypes, reason/)
  const paid = read('app/api/checkin/makeup/paid/route.ts')
  const answer = read('app/api/checkin/makeup/challenge/[challengeId]/answer/route.ts')
  const admin = read('app/api/admin/checkin-makeup/route.ts')
  for (const file of [paid, answer, admin]) {
    assert.match(file, /import \{ triggerBadgeEvaluation \} from '@\/lib\/badge-rule-engine'/)
    assert.match(file, /triggerBadgeEvaluation\(userId, 'CHECKIN_CREATED', `makeup:/)
  }
})
