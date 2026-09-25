import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isNormalCheckinOnConfiguredDate, normalizeCheckinOnDateRuleConfig } from '@/lib/checkin-specific-date'
import { generateBadgeAcquisitionDescription, parseBadgeRuleInput } from '@/lib/badge-rules'
import { getHistoricalBackfillCapability } from '@/lib/badge-historical'
import { canEvaluateCheckinOnDate } from '@/lib/badge-rule-engine'
import { getShanghaiDateKey } from '@/lib/checkin'

const read = (path: string) => readFileSync(path, 'utf8')

test('指定日期规则服务端规范化日期、排序并去重', () => {
  const config = normalizeCheckinOnDateRuleConfig({ dates: ['2026-11-19', '2026-10-03', '2026-10-03'] })
  assert.deepEqual(config, { dates: ['2026-10-03', '2026-11-19'] })
  assert.equal(normalizeCheckinOnDateRuleConfig({ dates: [] }), null)
  assert.equal(normalizeCheckinOnDateRuleConfig({ dates: ['2026-02-29'] }), null)
  assert.equal(normalizeCheckinOnDateRuleConfig({ dates: ['2026-02-30'] }), null)
  assert.equal(normalizeCheckinOnDateRuleConfig({ dates: ['2026-13-01'] }), null)
  assert.equal(normalizeCheckinOnDateRuleConfig({ dates: ['2026-1-03'] }), null)
})

test('指定日期边界使用上海自然日而不依赖运行机器时区', () => {
  assert.equal(getShanghaiDateKey(new Date('2026-10-03T15:59:59.000Z')), '2026-10-03')
  assert.equal(getShanghaiDateKey(new Date('2026-10-03T16:00:00.000Z')), '2026-10-04')
})

test('指定日期规则只接受一个或多个合法日期且不使用数值阈值', () => {
  const parsed = parseBadgeRuleInput({
    ruleType: 'CHECKIN_ON_DATE',
    operator: 'GTE',
    configJson: { dates: ['2026-11-19', '2026-10-03', '2026-10-03'] },
  })
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.rule?.ruleType, 'CHECKIN_ON_DATE')
  assert.equal(parsed.rule?.threshold, null)
  assert.deepEqual(parsed.rule?.configJson, { dates: ['2026-10-03', '2026-11-19'] })
  assert.match(parseBadgeRuleInput({ ruleType: 'CHECKIN_ON_DATE', configJson: { dates: [] } }).error || '', /至少指定一个有效日期/)
  assert.match(parseBadgeRuleInput({ ruleType: 'CHECKIN_ON_DATE', threshold: 1, configJson: { dates: ['2026-10-03'] } }).error || '', /不需要数值阈值/)
  assert.equal(parseBadgeRuleInput({ ruleType: 'CHECKIN_ON_DATE', configJson: { dates: ['2026-10-03'], extra: true } }).error, undefined)
})

test('指定日期规则文案和历史扫描能力来自统一注册表', () => {
  assert.equal(
    generateBadgeAcquisitionDescription('CHECKIN_ON_DATE', null, { dates: ['2026-10-03', '2026-11-19'] }),
    '在2026年10月3日、2026年11月19日中的任一指定日期完成正常挂号后获得；补签不计入。',
  )
  assert.equal(getHistoricalBackfillCapability('CHECKIN_ON_DATE').supported, true)
  assert.match(getHistoricalBackfillCapability('CHECKIN_ON_DATE').basis, /不会因新增规则自动扫描历史用户/)
})

test('正常挂号日期谓词排除全部补签类型并要求服务端用户与日期事实', () => {
  const base = {
    currentUserId: 'user-a',
    checkinUserId: 'user-a',
    checkinDateKey: '2026-10-03',
    configuredDates: ['2026-10-03'],
  }
  assert.equal(isNormalCheckinOnConfiguredDate({ ...base, checkinType: 'NORMAL', isMakeUp: false }), true)
  assert.equal(isNormalCheckinOnConfiguredDate({ ...base, checkinType: 'MAKEUP_PAID', isMakeUp: true }), false)
  assert.equal(isNormalCheckinOnConfiguredDate({ ...base, checkinType: 'MAKEUP_FREE_QUIZ', isMakeUp: true }), false)
  assert.equal(isNormalCheckinOnConfiguredDate({ ...base, checkinType: 'MAKEUP_ADMIN', isMakeUp: true }), false)
  assert.equal(isNormalCheckinOnConfiguredDate({ ...base, checkinType: 'NORMAL', isMakeUp: false, checkinDateKey: '2026-10-04' }), false)
  assert.equal(isNormalCheckinOnConfiguredDate({ ...base, checkinType: 'NORMAL', isMakeUp: false, checkinUserId: 'user-b' }), false)
})

test('仅明确标记的实时正常挂号事件可触发指定日期规则', () => {
  const live = { source: 'LIVE_CHECKIN' as const, eventType: 'CHECKIN_CREATED' as const, eventId: 'normal:checkin-1' }
  assert.equal(canEvaluateCheckinOnDate(live), true)
  assert.equal(canEvaluateCheckinOnDate({ ...live, source: 'HISTORICAL_RECONCILE' }), false)
  assert.equal(canEvaluateCheckinOnDate({ ...live, source: 'ADMIN_EXPLICIT_BACKFILL' }), false)
  assert.equal(canEvaluateCheckinOnDate({ ...live, eventId: 'makeup:checkin-1' }), false)
  assert.equal(canEvaluateCheckinOnDate({ ...live, eventType: 'USER_LOGIN' }), false)
})

test('自动授予只从正常挂号路由发出的服务端事件触发', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const normalRoute = read('app/api/checkin/route.ts')
  const reconcile = read('lib/checkin-derived-reconcile.ts')
  const adminBackfill = read('app/api/admin/badges/[badgeId]/backfill/route.ts')
  const makeupRoutes = [
    read('app/api/checkin/makeup/paid/route.ts'),
    read('app/api/checkin/makeup/challenge/[challengeId]/answer/route.ts'),
    read('app/api/admin/checkin-makeup/route.ts'),
  ]
  assert.match(normalRoute, /CHECKIN_CREATED', `normal:\$\{input\.checkInId\}`/)
  assert.match(normalRoute, /type: 'NORMAL',[\s\S]*isMakeUp: false/)
  assert.match(engine, /canEvaluateCheckinOnDate\(\{ source: evaluationSource, eventType: evaluationEventType, eventId \}\)/)
  assert.match(normalRoute, /'LIVE_CHECKIN'\)/)
  assert.match(engine, /type: 'NORMAL', isMakeUp: false/)
  assert.match(engine, /isNormalCheckinOnConfiguredDate/)
  assert.match(reconcile, /'HISTORICAL_RECONCILE'\)/)
  assert.match(adminBackfill, /backfillBadgeRule\(/)
  assert.match(engine, /case 'CHECKIN_ON_DATE':[\s\S]*?getBatchHistoricalBadgeMetrics/)
  for (const route of makeupRoutes) assert.match(route, /CHECKIN_CREATED', `makeup:/)
})

test('规则迁移仅扩展 BadgeRule 枚举，不写入业务数据', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260925100000_add_checkin_on_date_badge_rule/migration.sql')
  assert.match(schema, /enum BadgeRuleType[\s\S]*CHECKIN_ON_DATE/)
  assert.match(migration, /CHECKIN_ON_DATE/)
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE /i)
})
