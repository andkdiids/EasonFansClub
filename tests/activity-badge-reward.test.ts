import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { parseActivityDateInput } from '@/lib/activity'
import { hasValidActivityLotteryCheckIn } from '@/lib/activity-lottery'
import { hasValidActivityParticipation } from '@/lib/activity-participation'
import { BADGE_RULE_REGISTRY, parseBadgeRuleInput } from '@/lib/badge-rules'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const now = new Date('2026-09-01T04:00:00.000Z')
const end = new Date('2026-09-01T05:00:00.000Z')

test('活动勋章参与资格只认有效人工/二维码现场核销', () => {
  const manual = { status: 'ACTIVE', verifiedAt: new Date('2026-09-01T03:00:00.000Z'), checkedInAt: new Date('2026-09-01T03:00:00.000Z'), checkInSource: 'MANUAL' }
  const qr = { ...manual, checkInSource: 'QR' }
  const automatic = { ...manual, checkInSource: 'AUTO_AFTER_ACTIVITY_END' }
  assert.equal(hasValidActivityParticipation(manual, end, now), true)
  assert.equal(hasValidActivityParticipation(qr, end, now), true)
  assert.equal(hasValidActivityParticipation({ ...manual, status: 'CANCELLED' }, end, now), false)
  assert.equal(hasValidActivityParticipation({ ...manual, verifiedAt: null, checkedInAt: null, checkInSource: null }, end, now), false)
  assert.equal(hasValidActivityParticipation(automatic, end, now), false)
  assert.equal(hasValidActivityParticipation({ ...manual, checkedInAt: new Date('2026-09-01T06:00:00.000Z') }, end, now), false)
  assert.equal(hasValidActivityParticipation({ ...manual, checkedInAt: end }, end, now), false)
  assert.equal(hasValidActivityLotteryCheckIn(automatic, end, now), false)
})

test('活动奖励时间按北京时间分钟解析，配置勋章必须有目标规则', () => {
  assert.equal(parseActivityDateInput('2026-09-01T12:30')?.toISOString(), '2026-09-01T04:30:00.000Z')
  assert.equal(BADGE_RULE_REGISTRY.ACTIVITY_PARTICIPATION.targetKind, 'ACTIVITY')
  const parsed = parseBadgeRuleInput({ ruleType: 'ACTIVITY_PARTICIPATION', configJson: { activityId: 'activity_1' }, threshold: null })
  assert.equal(parsed.error, undefined)
  assert.deepEqual(parsed.rule?.configJson, { activityId: 'activity_1' })
})

test('活动奖励和参加活动规则共用幂等发放扫描器，并保留旧活动兼容分支', () => {
  const service = read('lib/activity-badge-rewards.ts')
  const registration = read('lib/activity-registration.ts')
  assert.match(service, /badgeGrantAt: \{ not: null, lte: now \}/)
  assert.match(service, /ruleType: activityParticipationRuleType/)
  assert.match(service, /hasValidActivityParticipation\(/)
  assert.match(service, /grantBadge\(/)
  assert.match(service, /sourceType: ACTIVITY_PARTICIPATION_BADGE_SOURCE/)
  assert.match(service, /sourceId: activityId/)
  assert.match(registration, /if \(reward && !reward\.badgeGrantAt\)/)
  assert.match(registration, /必须设置自动发放时间/)
})

test('发放时间编辑、启动补偿和签到后触发都走全局扫描', () => {
  const server = read('server.ts')
  const dailyJob = read('app/api/internal/daily-jobs/activity-auto-checkin/route.ts')
  const registration = read('lib/activity-registration.ts')
  const redemption = read('lib/activity-redemption.ts')
  const material = read('lib/material-redemptions.ts')
  const activityAdmin = read('app/admin/activities/ActivityAdminManager.tsx')
  assert.match(server, /grantEligibleActivityBadges/)
  assert.match(server, /setInterval\(\(\) => \{ void runActivityAutoCheckIn\(\) \}/)
  assert.match(dailyJob, /grantEligibleActivityBadges/)
  assert.match(registration, /activity\.badge-reward\.after-check-in/)
  assert.match(redemption, /activity\.redemption\.badge-reward/)
  assert.match(material, /material-redemption\.activity-badge-reward/)
  assert.match(activityAdmin, /badgeGrantAt/)
})

test('公开活动 DTO 不包含勋章奖励配置，管理端单独读取奖励时间', () => {
  const data = read('lib/activity-data.ts')
  const publicRoute = read('app/api/activities/[activityId]/route.ts')
  const detail = read('app/activities/[activityId]/page.tsx')
  const adminRoute = read('app/api/admin/activities/[activityId]/route.ts')
  assert.doesNotMatch(data, /ActivityReward|badgeGrantAt|rewardBadgeId/)
  assert.doesNotMatch(publicRoute, /ActivityReward|badgeGrantAt|rewardBadgeId/)
  assert.doesNotMatch(detail, /ActivityReward|badgeGrantAt|rewardBadgeId/)
  assert.match(adminRoute, /badgeGrantAt/)
})

test('活动参与规则使用现有活动选择器并拒绝失效自动签到解锁', () => {
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  const route = read('app/api/admin/badges/activities/route.ts')
  assert.match(manager, /ACTIVITY_PARTICIPATION/)
  assert.match(manager, /选择活动/)
  assert.match(manager, /activity\.status === 'PUBLISHED'/)
  assert.match(route, /status: true/)
  assert.match(read('lib/activity-participation.ts'), /AUTO_AFTER_ACTIVITY_END/)
})

test('活动勋章迁移只扩展字段和枚举，不写入现有生产记录', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260901090000_add_activity_badge_schedule/migration.sql')
  assert.match(schema, /badgeGrantAt\s+DateTime\?/)
  assert.match(schema, /ACTIVITY_PARTICIPATION/)
  assert.match(migration, /ADD COLUMN `badgeGrantAt` DATETIME\(3\) NULL/)
  assert.match(migration, /ACTIVITY_PARTICIPATION/)
  assert.doesNotMatch(migration, /UPDATE|DELETE|DROP TABLE|TRUNCATE/i)
})
