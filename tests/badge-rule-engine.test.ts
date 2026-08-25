import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evaluateBadgeMetric } from '@/lib/badge-rule-engine'
import { generateBadgeAcquisitionDescription, parseBadgeRuleInput, BADGE_RULE_REGISTRY, BADGE_RULE_TYPES } from '@/lib/badge-rules'
import { parseBadgeDefinition } from '@/lib/badge-admin'

const read = (path: string) => readFileSync(path, 'utf8')

test('规则模型为每枚勋章提供唯一结构化规则，并保留启停状态', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /enum BadgeRuleType\s*\{[\s\S]*?POST_COUNT[\s\S]*?RATING_COUNT/)
  assert.match(schema, /enum BadgeRuleOperator\s*\{[\s\S]*?GTE[\s\S]*?LTE[\s\S]*?EQ/)
  assert.match(schema, /model BadgeRule\s*\{[\s\S]*?badgeId\s+String\s+@unique[\s\S]*?isEnabled\s+Boolean\s+@default\(true\)/)
  assert.match(schema, /BadgeRule\s+BadgeRule\?/)
})

test('规则迁移只新增结构，不回写既有勋章或用户勋章记录', () => {
  const migration = read('prisma/migrations/20260822100000_add_badge_auto_rules/migration.sql')
  assert.match(migration, /ADD COLUMN `acquisitionDescriptionCustomized` BOOLEAN NOT NULL DEFAULT false/)
  assert.match(migration, /CREATE TABLE `BadgeRule`/)
  assert.match(migration, /UNIQUE INDEX `BadgeRule_badgeId_key`/)
  assert.match(migration, /ON DELETE CASCADE/)
  assert.doesNotMatch(migration, /UPDATE `Badge`|UPDATE `UserBadge`|DELETE FROM|DROP TABLE/i)
})

test('规则输入只接受受控类型、正整数阈值，首版后台只开放 GTE', () => {
  const parsed = parseBadgeRuleInput({ ruleType: 'post_count', operator: 'gte', threshold: '12' })
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.rule?.ruleType, 'POST_COUNT')
  assert.equal(parsed.rule?.threshold, 12)
  assert.equal(parsed.rule?.operator, 'GTE')
  assert.match(parseBadgeRuleInput({ ruleType: 'POST_COUNT', operator: 'LTE', threshold: 12 }).error || '', /仅支持/)
  assert.equal(parseBadgeRuleInput({ ruleType: 'POST_COUNT', operator: 1, threshold: 12 }).error, '自动获取规则操作符无效')
  assert.match(parseBadgeRuleInput({ ruleType: 'POST_COUNT', threshold: 0 }).error || '', /阈值/)
  assert.match(parseBadgeRuleInput({ ruleType: 'NOT_A_REAL_RULE', threshold: 1 }).error || '', /类型/)
  assert.match(parseBadgeRuleInput({ ruleType: 'POST_COUNT', threshold: 1, configJson: { table: 'users' } }).error || '', /自定义业务事件/)
  assert.match(parseBadgeRuleInput({ ruleType: 'POST_COUNT', threshold: 1, isEnabled: 'false' }).error || '', /启用标记/)
})

test('规则注册表统一提供指标、文案、阈值、操作符和事件映射', () => {
  assert.equal(BADGE_RULE_TYPES.length, 14)
  for (const ruleType of BADGE_RULE_TYPES) {
    const definition = BADGE_RULE_REGISTRY[ruleType]
    assert.equal(definition.metricLoader, ruleType)
    assert.ok(definition.label)
    assert.ok(definition.dataDescription)
    assert.deepEqual(definition.supportedOperators, ['GTE'])
    assert.ok(definition.events.length > 0)
    if (definition.threshold) {
      assert.equal(definition.threshold.min, 1)
      assert.equal(definition.threshold.max, 1_000_000_000)
    } else {
      assert.ok('targetKind' in definition)
    }
  }
})

test('legacy AUTO、EVENT、MANUAL 兼容，新建结构化 AUTO 必须有规则', () => {
  const base = { name: '测试勋章', code: 'test1' }
  assert.match(parseBadgeDefinition({ ...base, grantType: 'AUTO' }).error || '', /必须配置获取条件/)
  assert.equal(parseBadgeDefinition({ grantType: 'MANUAL', rule: { ruleType: 'POST_COUNT', threshold: 1 } }, true).error, '手动或事件勋章不能配置自动获取规则')
  assert.equal(parseBadgeDefinition({ ...base, grantType: 'EVENT' }).error, undefined)
  assert.equal(parseBadgeDefinition({ ...base, grantType: 'MANUAL' }).error, undefined)
  assert.match(read('app/api/admin/badges/[badgeId]/route.ts'), /keepsLegacyAutoFlow/)
  assert.match(read('lib/badge-rule-engine.ts'), /grantType: 'AUTO'/)
  assert.match(read('lib/badge-rule-engine.ts'), /isEnabled: true/)
})

test('默认获取文案集中生成，并覆盖所有首版支持指标', () => {
  assert.equal(generateBadgeAcquisitionDescription('POST_COUNT', 3), '累计发布 3 篇帖子后获得')
  assert.equal(generateBadgeAcquisitionDescription('CHECKIN_STREAK', 7), '连续挂号 7 天后获得')
  assert.equal(generateBadgeAcquisitionDescription('ACCOUNT_AGE_DAYS', 365), '注册满 365 天后获得')
  assert.equal(generateBadgeAcquisitionDescription('DUEL_WIN_COUNT', 5), '累计赢得 5 场听听 1v1 对决后获得')
  assert.equal(generateBadgeAcquisitionDescription('RATING_COUNT', 10), '累计完成 10 次歌·颂评分后获得')
})

test('指标操作符支持 GTE、LTE、EQ，且边界值按规则计算', () => {
  assert.equal(evaluateBadgeMetric(100, 'GTE', 100), true)
  assert.equal(evaluateBadgeMetric(99, 'GTE', 100), false)
  assert.equal(evaluateBadgeMetric(100, 'LTE', 100), true)
  assert.equal(evaluateBadgeMetric(101, 'LTE', 100), false)
  assert.equal(evaluateBadgeMetric(100, 'EQ', 100), true)
  assert.equal(evaluateBadgeMetric(99, 'EQ', 100), false)
})

test('规则引擎复用中心授予服务、按事件筛选规则并提供游标批处理', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /grantBadge\(/)
  assert.match(engine, /sourceType: 'AUTO_RULE'/)
  assert.match(engine, /EVENT_RULE_TYPES/)
  assert.match(engine, /take: boundedBatchSize \+ 1/)
  assert.match(engine, /id: \{ gt: normalizedCursor \}/)
  assert.doesNotMatch(engine, /userBadge\.create\(/)
  assert.match(engine, /status: 'COMPLETED'/)
  assert.doesNotMatch(engine, /status: \{ in: \['COMPLETED', 'EXPIRED'\] \}/)
})

test('事件触发不阻塞主流程，且关键业务成功后才调用', () => {
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(engine, /const task = evaluateBadgesForEvent\(userId, eventType\)/)
  assert.match(engine, /void task/)
  assert.match(read('app/api/posts/route.ts'), /moderationStatus === 'APPROVED'\) triggerBadgeEvaluation\(user\.id, 'POST_CREATED'\)/)
  assert.match(read('app/api/checkin/route.ts'), /triggerBadgeEvaluation\(input\.userId, 'CHECKIN_CREATED'\)/)
  assert.match(read('app/api/admin/posts/review/route.ts'), /triggerBadgeEvaluation\(current\.authorId, 'POST_APPROVED'\)/)
  assert.match(read('lib/guess-song-session.ts'), /triggerBadgeEvaluation\(input\.userId, 'GUESS_SONG_SESSION_FINISHED'\)/)
  assert.match(read('lib/guess-song-session.ts'), /!outcome\.duplicate && session\.status === 'COMPLETED'/)
  assert.match(read('app/api/users/[userId]/follow/route.ts'), /prisma\.follow\.create/)
  assert.match(read('app/api/users/[userId]/follow/route.ts'), /error\.code === 'P2002'/)
  assert.doesNotMatch(read('lib/friends.ts'), /badge-rule-engine/)
  assert.match(read('app/api/friends/requests/[requestId]/accept/route.ts'), /triggerBadgeEvaluation/)
})

test('自动规则管理和批量补发接口都要求成就管理权限并记录审计', () => {
  const createRoute = read('app/api/admin/badges/route.ts')
  const updateRoute = read('app/api/admin/badges/[badgeId]/route.ts')
  const backfillRoute = read('app/api/admin/badges/[badgeId]/backfill/route.ts')
  assert.match(createRoute, /parseBadgeDefinition/)
  assert.match(createRoute, /BADGE_AUTO_RULE_CREATE/)
  assert.match(updateRoute, /BADGE_AUTO_RULE_UPDATE|BADGE_AUTO_RULE_DISABLE/)
  assert.match(backfillRoute, /requireAdmin\('achievement_manage'\)/)
  assert.match(backfillRoute, /BADGE_AUTO_BACKFILL/)
  assert.match(read('lib/badge-admin.ts'), /data\.grantType === 'AUTO' && !rule/)
})

test('公共勋章查询不读取或返回 BadgeRule，管理员查询才包含规则', () => {
  const service = read('lib/badge-service.ts')
  const publicSelectEnd = service.indexOf('} as const', service.indexOf('const BADGE_SELECT'))
  const publicSelect = service.slice(service.indexOf('const BADGE_SELECT'), publicSelectEnd)
  assert.doesNotMatch(publicSelect, /BadgeRule/)
  assert.match(service, /export const badgeAdminSelect = \{[\s\S]*BadgeRule:/)
  assert.match(service, /function hiddenBadgeView[\s\S]*name: '\?\?\?'[\s\S]*acquisitionDescription: null/)
  assert.match(read('app/api/admin/badges/route.ts'), /rule: BadgeRule \|\| null/)
  assert.match(read('app/api/admin/badges/[badgeId]/route.ts'), /rule: BadgeRule \|\| null/)
})

test('后台补发严格限制批次和游标，重复补发由中心服务幂等处理', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const route = read('app/api/admin/badges/[badgeId]/backfill/route.ts')
  assert.match(engine, /BACKFILL_BATCH_MIN.*BACKFILL_BATCH_MAX/)
  assert.match(engine, /批量补发游标格式无效/)
  assert.match(route, /normalizeBackfillBatchSize/)
  assert.match(route, /normalizeBackfillCursor/)
  assert.match(engine, /sourceType: 'AUTO_RULE'/)
})

test('自定义文案字段在管理端和 API 中有显式保护逻辑', () => {
  assert.match(read('app/admin/badges/BadgeAdminManager.tsx'), /自定义文案，修改规则时保留/)
  assert.match(read('app/admin/badges/BadgeAdminManager.tsx'), /恢复默认文案/)
  assert.match(read('app/api/admin/badges/[badgeId]/route.ts'), /previous\.acquisitionDescriptionCustomized/)
  assert.match(read('app/api/admin/badges/route.ts'), /generateBadgeAcquisitionDescription/)
})
