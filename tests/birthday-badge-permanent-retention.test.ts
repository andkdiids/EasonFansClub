import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { evaluateBadgeRule } from '@/lib/badge-rule-engine'
import {
  BADGE_RULE_REGISTRY,
  getDefaultBadgeRetentionPolicy,
  isAcquisitionOnlyBadgeRule,
  resolveBadgeRetentionPolicy,
  supportsBadgeRetentionPolicy,
} from '@/lib/badge-rules'
import { calculateBadgeExpiresAt, isUserBadgeCurrent } from '@/lib/badge-validity'

const read = (path: string) => readFileSync(path, 'utf8')

test('生日当天只决定获取窗口，过零点后永久 ownership 仍应保持有效', () => {
  const rule = { ruleType: 'BIRTHDAY_TODAY' as const, operator: 'GTE' as const, threshold: null, configJson: {} }
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 9, birthDay: 10 }, rule, now: new Date('2026-09-10T04:00:00.000Z') }), true)
  assert.equal(evaluateBadgeRule({ user: { birthMonth: 9, birthDay: 10 }, rule, now: new Date('2026-09-10T16:01:00.000Z') }), false)
  assert.equal(isAcquisitionOnlyBadgeRule('BIRTHDAY_TODAY'), true)
  assert.equal(BADGE_RULE_REGISTRY.BIRTHDAY_TODAY.supportsRetentionWhileEligible, false)
  assert.equal(supportsBadgeRetentionPolicy('BIRTHDAY_TODAY'), false)
  assert.equal(getDefaultBadgeRetentionPolicy('BIRTHDAY_TODAY'), 'PERMANENT_AFTER_GRANT')
  assert.equal(resolveBadgeRetentionPolicy({ ruleType: 'BIRTHDAY_TODAY', retentionPolicy: null }), 'PERMANENT_AFTER_GRANT')
  assert.equal(resolveBadgeRetentionPolicy({ ruleType: 'BIRTHDAY_TODAY', retentionPolicy: 'RETAIN_WHILE_ELIGIBLE' }), 'PERMANENT_AFTER_GRANT')
  assert.equal(calculateBadgeExpiresAt(new Date('2026-09-10T04:00:00.000Z'), 'PERMANENT', null), null)
  assert.equal(isUserBadgeCurrent({ status: 'ACTIVE', expiresAt: null }, new Date('2027-09-10T04:00:00.000Z')), true)
})

test('所有 retention / sustained 入口都把 BIRTHDAY_TODAY 视为获取专用规则', () => {
  const retention = read('lib/badge-retention.ts')
  const aspirin = read('lib/aspirin-badge.ts')
  const birthday = read('lib/birthday.ts')
  assert.match(retention, /isAcquisitionOnlyBadgeRule\(rule\.ruleType\)/)
  assert.match(retention, /isAcquisitionOnlyBadgeRule\(context\.rule\.ruleType\)/)
  assert.match(aspirin, /isAcquisitionOnlyBadgeRule\(input\.rule\.ruleType\)/)
  assert.match(aspirin, /ruleType: \{ not: 'BIRTHDAY_TODAY' \}/)
  assert.match(birthday, /生日当天仅是获取窗口，不会回收历史 ownership/)
})
