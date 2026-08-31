import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { orderActivityRedemptionSelections } from '@/lib/activity-redemption'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('统一核销 Lookup 为可处理权益提供默认选择元数据，等待签到奖品保持可选', () => {
  const redemption = read('lib/activity-redemption.ts')
  const manager = read('components/activities/ActivityRegistrationManager.tsx')

  assert.match(redemption, /selectable: boolean/)
  assert.match(redemption, /defaultSelected: boolean/)
  assert.match(redemption, /requires: ActivityRedemptionEntitlementType\[\]/)
  assert.match(redemption, /blockedReason: string \| null/)
  assert.match(redemption, /return \{ selectable, defaultSelected: selectable, requires, blockedReason \}/)
  assert.match(redemption, /redemptionState === 'WAITING_FOR_CHECK_IN' \|\| redemptionState === 'REDEEMABLE'/)
  assert.match(redemption, /\['ACTIVITY_REGISTRATION'\]/)
  assert.match(manager, /filter\(\(item\) => item\.defaultSelected\)/)
  assert.match(manager, /disabled=\{!item\.selectable \|\| busyId === 'qr-confirm'\}/)
  assert.doesNotMatch(manager, /disabled=\{!item\.redeemable \|\| busyId === 'qr-confirm'\}/)
})

test('统一核销服务端固定依赖顺序，客户端顺序不能让奖品先于签到', () => {
  const redemption = read('lib/activity-redemption.ts')
  const selections = [
    { type: 'LOTTERY_PRIZE' as const, id: 'prize-1' },
    { type: 'MATERIAL' as const, id: 'material-1' },
    { type: 'ACTIVITY_REGISTRATION' as const, id: 'registration-1' },
    { type: 'LOTTERY_PRIZE' as const, id: 'prize-2' },
  ]

  assert.deepEqual(orderActivityRedemptionSelections(selections).map((item) => item.type), [
    'ACTIVITY_REGISTRATION',
    'MATERIAL',
    'LOTTERY_PRIZE',
    'LOTTERY_PRIZE',
  ])
  assert.match(redemption, /const orderedSelections = orderActivityRedemptionSelections\(selections\)/)
  assert.match(redemption, /for \(const selection of orderedSelections\)/)
  assert.match(redemption, /registration = await readLockedRegistration\(tx, registration\.id\)/)
  assert.match(redemption, /redeemLinkedMaterial: false/)
  assert.match(redemption, /该奖品需要完成活动签到后才能兑奖，请同时勾选活动签到/)
})

test('统一核销保留物料独立处理、同事务回滚与重复兑奖保护', () => {
  const redemption = read('lib/activity-redemption.ts')
  assert.match(redemption, /redeemActivityLinkedMaterialInTransaction\(tx, \{ activityId, registrationId: registration\.id, orderId: selection\.id, adminId \}/)
  assert.match(redemption, /if \(redemptionState === 'EXPIRED'\)/)
  assert.match(redemption, /redemptionStatus: 'PENDING'/)
  assert.match(redemption, /SELECT .*LotteryEntry.*FOR UPDATE/)
  assert.match(redemption, /if \(latest\?\.redemptionStatus === 'REDEEMED'\) return \{ id: winner\.id, status: 'ALREADY_REDEEMED'/)
})
