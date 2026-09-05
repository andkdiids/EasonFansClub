import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBadgeDefinition } from '@/lib/badge-admin'
import { BADGE_RULE_REGISTRY, BADGE_RULE_TYPES_WITH_SPECIAL } from '@/lib/badge-rules'

const read = (path: string) => readFileSync(path, 'utf8')

test('普通勋章允许任意数量的空成长等级字段', () => {
  const first = parseBadgeDefinition({ name: '普通勋章甲', grantType: 'MANUAL', tierEnabled: false, tierLevel: null })
  const second = parseBadgeDefinition({ name: '普通勋章乙', grantType: 'MANUAL', tierEnabled: false, tierLevel: null })
  assert.equal(first.error, undefined)
  assert.equal(second.error, undefined)
  assert.equal(first.data?.tierLevel, null)
  assert.equal(second.data?.tierLevel, null)
})

test('不同成长系列可以使用相同等级，同一系列等级仍由数据库唯一约束保护', () => {
  assert.equal(parseBadgeDefinition({ name: '发帖达人1级', grantType: 'AUTO', seriesId: 'posts', tierEnabled: true, tierLevel: 1, rule: { ruleType: 'POST_COUNT', operator: 'GTE', threshold: 10 } }).error, undefined)
  assert.equal(parseBadgeDefinition({ name: '连续挂号1级', grantType: 'AUTO', seriesId: 'checkins', tierEnabled: true, tierLevel: 1, rule: { ruleType: 'CHECKIN_STREAK', operator: 'GTE', threshold: 7 } }).error, undefined)
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /@@unique\(\[tierGroupCode, tierLevel\]\)/)
  assert.doesNotMatch(schema, /@@unique\(\[tierLevel\]\)/)
})

test('成长等级只接受1到99的安全整数，并要求成长系列', () => {
  for (const tierLevel of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100]) {
    assert.match(parseBadgeDefinition({ name: `无效等级${String(tierLevel)}`, grantType: 'MANUAL', seriesId: 'series', tierEnabled: true, tierLevel }).error || '', /等级/)
  }
  assert.equal(parseBadgeDefinition({ name: '99级勋章', grantType: 'MANUAL', seriesId: 'series', tierEnabled: true, tierLevel: 99 }).error, undefined)
  assert.match(parseBadgeDefinition({ name: '缺系列勋章', grantType: 'MANUAL', tierEnabled: true, tierLevel: 1 }).error || '', /成长系列/)
  assert.match(parseBadgeDefinition({ name: '缺等级勋章', grantType: 'MANUAL', seriesId: 'series', tierEnabled: true }).error || '', /等级/)
})

test('code和slug只由服务端生成，编辑不会从客户端覆盖', () => {
  const parser = read('lib/badge-admin.ts')
  const createRoute = read('app/api/admin/badges/route.ts')
  assert.match(parser, /code\/slug are immutable internal identifiers/)
  assert.match(createRoute, /data\.code = generatedCode/)
  assert.match(createRoute, /data\.slug = generatedCode/)
  assert.doesNotMatch(parser, /data\.code\s*=\s*body\.code/)
  assert.doesNotMatch(parser, /data\.slug\s*=\s*body\.slug/)
})

test('重复错误按名称、标识和成长系列等级分别给出中文提示', () => {
  const admin = read('lib/badge-admin.ts')
  assert.match(admin, /已存在同名勋章/)
  assert.match(admin, /系统标识发生冲突/)
  assert.match(admin, /页面标识发生冲突/)
  assert.match(admin, /该成长系列已经存在/)
  assert.doesNotMatch(read('app/api/admin/badges/route.ts'), /名称、code 或标识已经存在/)
  assert.doesNotMatch(read('app/api/admin/badges/[badgeId]/route.ts'), /名称、code 或标识已经存在/)
})

test('规则注册表逐项声明限定期历史回溯能力和依据', () => {
  for (const ruleType of BADGE_RULE_TYPES_WITH_SPECIAL) {
    const definition = BADGE_RULE_REGISTRY[ruleType]
    assert.equal(typeof definition.supportsHistoricalBackfill, 'boolean')
    assert.ok(definition.historicalBasis.length > 0)
  }
  for (const ruleType of ['POST_COUNT', 'CHECKIN_TOTAL_DAYS', 'CHECKIN_STREAK', 'ACCOUNT_AGE_DAYS', 'GUESS_SONG_MAX_STREAK', 'CONCERT_ATTENDANCE_COUNT', 'CONCERT_SHOW_ATTENDED', 'CONCERT_TOUR_ATTENDED', 'RATING_COUNT'] as const) assert.equal(BADGE_RULE_REGISTRY[ruleType].supportsHistoricalBackfill, true)
  for (const ruleType of ['FEATURED_POST_COUNT', 'FRIEND_COUNT', 'FOLLOWER_COUNT', 'DUEL_WIN_COUNT', 'WANT_LISTEN_MAX_STREAK', 'BADGE_SERIES_COMPLETE', 'ACTIVITY_PARTICIPATION'] as const) assert.equal(BADGE_RULE_REGISTRY[ruleType].supportsHistoricalBackfill, false)
})

test('历史指标只读取限定窗口内可证明时间的事实', () => {
  const historical = read('lib/badge-historical.ts')
  assert.match(historical, /getHistoricalQualificationWindow/)
  assert.match(historical, /createdAt\s*[,}]/)
  assert.match(historical, /checkDate: createdAt/)
  assert.match(historical, /completedAt: createdAt/)
  assert.match(historical, /该规则无法可靠判断限定期历史资格/)
  assert.doesNotMatch(historical, /getUserBadgeMetric\(/)
})

test('自动补发区分实时和历史窗口模式，并且仍统一经过grantBadge', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const service = read('lib/badge-service.ts')
  assert.match(engine, /mode: 'CURRENT' \| 'HISTORICAL_WINDOW'/)
  assert.match(engine, /availabilityMode: mode/)
  assert.match(engine, /getBatchHistoricalBadgeMetrics/)
  assert.match(engine, /限定期历史资格补发/)
  assert.match(service, /BadgeGrantAvailabilityMode = 'CURRENT' \| 'HISTORICAL_WINDOW' \| 'ADMIN_MANUAL'/)
  assert.match(service, /availabilityMode === 'CURRENT'/)
  assert.match(service, /availabilityMode === 'HISTORICAL_WINDOW'/)
  assert.match(engine, /grantBadge\(/)
  assert.doesNotMatch(engine, /prisma\.userBadge\.create/)
})

test('限定勋章预览保持只读，并返回历史能力说明', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const preview = engine.slice(engine.indexOf('export async function previewBadgeRule'))
  assert.match(preview, /historical/)
  assert.match(preview, /UNSUPPORTED/)
  assert.match(preview, /getBatchHistoricalBadgeMetrics/)
  assert.doesNotMatch(preview, /grantBadge\(/)
})

test('已绝版勋章只允许显式历史窗口或管理员手动模式，实时规则仍拒绝', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /availabilityMode === 'CURRENT' && availability !== 'PERMANENT'/)
  assert.match(service, /availabilityMode === 'HISTORICAL_WINDOW'/)
  assert.match(service, /availabilityMode === 'ADMIN_MANUAL'/)
  assert.match(service, /限定勋章手动补发必须填写补发原因/)
})

test('后台人工补发需要成就管理权限、限定原因和审计动作', () => {
  const route = read('app/api/admin/badges/[badgeId]/grant/route.ts')
  assert.match(route, /requireAdmin\('achievement_manage'\)/)
  assert.match(route, /限定勋章手动补发必须填写补发原因/)
  assert.match(route, /availabilityMode: 'ADMIN_MANUAL'/)
  assert.match(route, /BADGE_MANUAL_BACKFILL/)
  assert.match(route, /grantBadge\(/)
})

test('自动历史补发仍使用游标和100到500批次，并把窗口写入管理员审计', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const route = read('app/api/admin/badges/[badgeId]/backfill/route.ts')
  assert.match(engine, /BACKFILL_BATCH_MIN = 100/)
  assert.match(engine, /BACKFILL_BATCH_MAX = 500/)
  assert.match(route, /BADGE_AUTO_BACKFILL/)
  assert.match(route, /historicalWindow: summary\.historicalWindow/)
  assert.match(route, /mode: summary\.mode/)
})

test('历史补发不伪造获得时间、不改变限定状态，且幂等删除追踪', () => {
  const service = read('lib/badge-service.ts')
  const engine = read('lib/badge-rule-engine.ts')
  assert.match(service, /const awardedAt = input\.obtainedAt \|\| now/)
  assert.match(service, /userBadgeTracking\.deleteMany/)
  assert.match(service, /calculateBadgeExpiresAt/)
  assert.match(service, /grantKey/)
  assert.doesNotMatch(engine, /obtainedAt: .*availableUntil/)
})

test('本轮不新增第二套Tier模型或migration', () => {
  assert.doesNotMatch(read('prisma/schema.prisma'), /model BadgeTierGroup/)
  assert.doesNotMatch(read('prisma/schema.prisma'), /tierGroupId\s+String/)
})
