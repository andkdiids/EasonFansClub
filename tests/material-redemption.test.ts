import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  canExchangeMaterial,
  compareMaterialRuleValue,
  getMaterialExchangeState,
  validateMaterialRedemptionSchedule,
} from '@/lib/material-redemption-domain'
import { normalizeMaterialRules } from '@/lib/material-redemptions'

const schedule = {
  exchangeStartAt: new Date('2026-08-25T00:00:00.000Z'),
  exchangeEndAt: new Date('2026-08-26T00:00:00.000Z'),
  redeemEndAt: new Date('2026-08-27T00:00:00.000Z'),
}

test('物料兑换时间必须满足开始 < 兑换截止 <= 核销截止', () => {
  assert.equal(validateMaterialRedemptionSchedule(schedule), null)
  assert.equal(validateMaterialRedemptionSchedule({ ...schedule, exchangeEndAt: schedule.exchangeStartAt }), '兑换开始时间必须早于兑换结束时间')
  assert.equal(validateMaterialRedemptionSchedule({ ...schedule, redeemEndAt: new Date('2026-08-25T12:00:00.000Z') }), '兑换结束时间不能晚于核销截止时间')
})

test('发布物料的状态在时间边界上可预测', () => {
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, new Date('2026-08-24T23:59:59.000Z')), 'UPCOMING')
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, schedule.exchangeStartAt), 'ACTIVE')
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, schedule.exchangeEndAt), 'ACTIVE')
  assert.equal(getMaterialExchangeState('PUBLISHED', schedule, new Date('2026-08-26T00:00:01.000Z')), 'ENDED')
  assert.equal(getMaterialExchangeState('PAUSED', schedule, schedule.exchangeStartAt), 'PAUSED')
  assert.equal(canExchangeMaterial('PAUSED', schedule, schedule.exchangeStartAt), false)
})

test('资格数值运算符和条件结构只允许后端定义的形式', () => {
  assert.equal(compareMaterialRuleValue(10, 'GTE', 10), true)
  assert.equal(compareMaterialRuleValue(10, 'LTE', 9), false)
  assert.equal(compareMaterialRuleValue(10, 'EQ', 10), true)
  assert.deepEqual(normalizeMaterialRules([{ type: 'CHECKIN_TOTAL', operator: 'GTE', value: '3' }]), { rules: [{ type: 'CHECKIN_TOTAL', operator: 'GTE', value: '3' }] })
  const mixed = normalizeMaterialRules([{ type: 'NONE', operator: 'EQ', value: '' }, { type: 'CHECKIN_TOTAL', operator: 'GTE', value: '3' }])
  assert.equal('error' in mixed, true)
  if ('error' in mixed) assert.match(mixed.error, /无门槛条件不能与其他条件同时存在/)
  const invalidOperator = normalizeMaterialRules([{ type: 'HAS_BADGE', operator: 'GTE', value: 'badge-id' }])
  assert.equal('error' in invalidOperator, true)
  if ('error' in invalidOperator) assert.match(invalidOperator.error, /只能使用等于/)
})

test('兑换服务保留事务、幂等、条件库存扣减和订单归属保护', () => {
  const service = readFileSync('lib/material-redemptions.ts', 'utf8')
  const registrationFee = readFileSync('lib/registration-fee.ts', 'utf8')
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(service, /const\s+result\s*=\s*await\s+prisma\.\$transaction\(async\s+\(tx\)/)
  assert.match(service, /findUnique\(\{\s*where:\s*\{\s*idempotencyKey:\s*input\.idempotencyKey\s*\}/)
  assert.match(service, /return\s+\{\s*duplicate:\s*true,\s*order:/)
  assert.match(service, /stockRemaining:\s*\{\s*gte:\s*input\.quantity\s*\}/)
  assert.match(service, /if\s*\(stockChanged\.count\s*!==\s*1\)/)
  assert.match(service, /const\s+created\s*=\s*await\s+tx\.materialRedemptionOrder\.create/)
  assert.match(service, /businessKey:\s*`material-redemption:\$\{created\.id\}`/)
  assert.match(service, /where:\s*\{\s*id:\s*orderId,\s*userId\s*\}/)
  assert.match(service, /where:\s*\{\s*id:\s*order\.id,\s*status:\s*'SUCCESS'\s*\},\s*data:\s*\{\s*status:\s*'REDEEMED'/)
  assert.match(service, /if\s*\(changed\.count\s*!==\s*1\)/)
  assert.match(service, /if\s*\(order\.status\s*===\s*'REFUNDED'\)\s*return\s+\{\s*duplicate:\s*true/)
  assert.match(service, /const\s+restored\s*=\s*await\s+tx\.materialRedemption\.updateMany/)
  assert.match(service, /businessKey:\s*`material-redemption-refund:\$\{order\.id\}`/)
  assert.match(service, /status:\s*'REDEEMED'/)
  assert.match(service, /awardRegistrationFee\(tx,\s*\{/)
  assert.match(registrationFee, /export async function consumeRegistrationFee\(\s*tx:\s*Prisma\.TransactionClient/)
  assert.match(registrationFee, /export async function awardRegistrationFee\(\s*tx:\s*Prisma\.TransactionClient/)
  assert.match(registrationFee, /await tx\.pointLog\.create/)
  assert.match(schema, /idempotencyKey\s+String\s+@unique/)
})
