import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { getActivityLotteryWinnerRedemptionState } from '@/lib/activity-lottery'
import { getActivityRegistrationState } from '@/lib/activity-registration'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('统一取消服务覆盖单个、批量和活动取消，并只处理未核销报名', () => {
  const service = read('lib/activity-registration.ts')
  const activityRoute = read('app/api/admin/activities/[activityId]/route.ts')

  assert.match(service, /export async function cancelActivityRegistration\(/)
  assert.match(service, /export async function cancelAllActivityRegistrations\(/)
  assert.match(service, /export async function cancelActivity\(/)
  assert.match(service, /type ActivityRegistrationCancellationSource = 'USER' \| 'ADMIN' \| 'ACTIVITY'/)
  assert.match(service, /if \(registration\.status === 'CANCELLED'\)/)
  assert.match(service, /if \(registration\.paidRegistrationFee > 0\)/)
  assert.match(service, /requestedAmount: registration\.paidRegistrationFee/)
  assert.match(service, /action: 'ACTIVITY_REGISTRATION_REFUND'/)
  assert.match(service, /businessKey: `activity-registration-refund:\$\{registration\.id\}`/)
  assert.match(service, /data: \{ status: 'CANCELLED', cancelledAt: now \}/)
  assert.match(service, /where: \{ activityId: input\.activityId, status: 'ACTIVE', verifiedAt: null \}/)
  assert.match(activityRoute, /cancelActivityInTransaction\(tx, \{ activityId: updated\.id, adminId: guard\.user\.id, now \}\)/)
  assert.match(activityRoute, /success: true/)
  assert.match(activityRoute, /registrationsCancelled/)
  assert.match(activityRoute, /refundedAmount/)
})

test('管理员单独取消和取消全部都有服务端权限、确认和明确结果', () => {
  const singleRoute = read('app/api/admin/activities/[activityId]/registrations/[registrationId]/cancel/route.ts')
  const batchRoute = read('app/api/admin/activities/[activityId]/registrations/cancel-all/route.ts')
  const manager = read('components/activities/ActivityRegistrationManager.tsx')
  const activityManager = read('app/admin/activities/ActivityAdminManager.tsx')

  assert.match(singleRoute, /requireAdmin\('activity_manage'\)/)
  assert.match(singleRoute, /source: 'ADMIN'/)
  assert.match(singleRoute, /success: true/)
  assert.match(singleRoute, /refundedAmount: result\.refundedAmount/)
  assert.match(batchRoute, /requireAdmin\('activity_manage'\)/)
  assert.match(batchRoute, /body\?\.confirm !== true/)
  assert.match(batchRoute, /cancelAllActivityRegistrations\(\{ activityId, source: 'ADMIN'/)
  assert.match(batchRoute, /success: true/)
  assert.match(manager, /取消报名/)
  assert.match(manager, /ConfirmDialog open=\{Boolean\(cancelTarget\)\}/)
  assert.match(manager, /取消所有未核销报名？/)
  assert.match(manager, /summary\.unverifiedActiveCount/)
  assert.match(activityManager, /确认取消活动？/)
  assert.match(activityManager, /unverifiedActivePaidFeeTotal/)
})

test('取消事务锁定活动、报名、物料和用户，重复执行不重复退款', () => {
  const service = read('lib/activity-registration.ts')
  const fee = read('lib/registration-fee.ts')

  assert.match(service, /SELECT[\s\S]*Activity[\s\S]*FOR UPDATE/)
  assert.match(service, /SELECT[\s\S]*ActivityRegistration[\s\S]*FOR UPDATE/)
  assert.match(service, /SELECT[\s\S]*MaterialRedemptionOrder[\s\S]*FOR UPDATE/)
  assert.match(service, /cancelActivityRegistrationLockedInTransaction/)
  assert.match(service, /refundDuplicate = refund\.duplicate/)
  assert.match(service, /duplicateRefunds/)
  assert.match(fee, /businessKey/)
  assert.match(fee, /existingAfterLock/)
  assert.doesNotMatch(service, /tx\.activityRegistration\.delete/)
  assert.doesNotMatch(service, /tx\.user\.update\([\s\S]*balance/)
})

test('活动取消只处理未核销报名，但会让活动二维码和抽奖失效并保留已核销历史', () => {
  const service = read('lib/activity-registration.ts')
  const lottery = read('lib/activity-lottery.ts')
  const redemption = read('lib/activity-redemption.ts')
  const button = read('components/activities/ActivityRegistrationButton.tsx')
  const detail = read('components/activities/ActivityDetailView.tsx')

  assert.match(service, /source: 'ACTIVITY'/)
  assert.match(service, /status: 'ACTIVE', verifiedAt: null/)
  assert.match(service, /cancelUndrawnActivityLotteriesInTransaction\(tx, input\.activityId, now\)/)
  assert.match(lottery, /status: \{ not: 'CANCELLED' \}/)
  assert.match(lottery, /activityCancelled: row\.Activity\?\.status === 'CANCELLED'/)
  assert.match(redemption, /if \(registration\.Activity\.status === 'CANCELLED'\).*ACTIVITY_CANCELLED/)
  assert.match(redemption, /if \(current\.Activity\.status === 'CANCELLED'\).*ACTIVITY_CANCELLED/)
  assert.match(button, /const isActivityCancelled = activity\.status === 'CANCELLED'/)
  assert.match(button, /const currentLabel = isRegistered && registration\?\.verifiedAt[\s\S]*?已核销/)
  assert.match(detail, /activity\.status !== 'CANCELLED' && lotteries\.length/)
  assert.doesNotMatch(service, /activityRegistration\.delete|tx\.activityRegistration\.delete/)
})

test('管理员取消与用户取消保留不同业务入口，已核销报名在服务端统一拒绝', () => {
  const service = read('lib/activity-registration.ts')
  const singleRoute = read('app/api/admin/activities/[activityId]/registrations/[registrationId]/cancel/route.ts')
  const userRoute = read('app/api/activities/[activityId]/register/cancel/route.ts')
  const manager = read('components/activities/ActivityRegistrationManager.tsx')

  assert.match(singleRoute, /source: 'ADMIN'/)
  assert.match(userRoute, /source: 'USER'/)
  assert.match(service, /if \(registration\.verifiedAt\) throw new ActivityRegistrationError\('REGISTRATION_ALREADY_CHECKED_IN'/)
  assert.match(service, /status: 'ACTIVE', verifiedAt: null/)
  assert.match(service, /source: 'ACTIVITY'/)
  assert.match(manager, /registration\.status === 'ACTIVE' && !registration\.verifiedAt/)
  assert.match(manager, /活动状态：活动取消/)
})

test('取消报名和活动后，后台与前台保留每条报名的真实状态', () => {
  const adminList = read('app/api/admin/activities/[activityId]/registrations/route.ts')
  const manager = read('components/activities/ActivityRegistrationManager.tsx')
  const button = read('components/activities/ActivityRegistrationButton.tsx')
  const activityApi = read('app/api/activities/[activityId]/route.ts')

  assert.match(adminList, /displayStatus: registration\.status === 'CANCELLED' \? 'CANCELLED'/)
  assert.doesNotMatch(adminList, /displayStatus: activity\.status === 'CANCELLED'/)
  assert.match(manager, /registration\.status === 'CANCELLED' \? '已取消'/)
  assert.match(manager, /registration\.verifiedAt \? `已核销/)
  assert.match(button, /!isActivityCancelled && !isRegistered && !isCancelled/)
  assert.match(button, /本活动已取消；您的报名已核销[\s\S]*本次不退款/)
  assert.match(activityApi, /const isRegistered = registration\?\.status === 'ACTIVE'/)
  assert.match(activityApi, /registrationStatus: registration\?\.status \|\| null/)
  assert.match(activityApi, /canRegister: availability\.canRegister[\s\S]*!activityCancelled && !isRegistered && !isCancelled/)
})

test('活动取消与单独取消都会让核销接口拒绝，自动核销也跳过取消活动', () => {
  const registration = read('lib/activity-registration.ts')
  const redemption = read('lib/activity-redemption.ts')
  const material = read('lib/material-redemptions.ts')

  assert.match(registration, /if \(activity\.status === 'CANCELLED'\) throw new ActivityVerificationError\('ACTIVITY_CANCELLED'/)
  assert.match(registration, /if \(current\.status === 'CANCELLED'\) throw new ActivityVerificationError\('REGISTRATION_CANCELLED'/)
  assert.match(registration, /if \(activity\.status === 'CANCELLED'\) return \{ processed: false, reason: 'ACTIVITY_CANCELLED'/)
  assert.match(redemption, /if \(registration\.Activity\.status === 'CANCELLED'\) throw new ActivityRedemptionError\('ACTIVITY_CANCELLED'/)
  assert.match(redemption, /if \(current\.Activity\.status === 'CANCELLED'\) throw new ActivityRedemptionError\('ACTIVITY_CANCELLED'/)
  assert.match(material, /if \(isCancelledActivityMaterialOrder\(order\)\) throw new MaterialRedemptionError\('ACTIVITY_CANCELLED'/)
})

test('免费报名不产生零额退款，修改活动当前费用也不改变历史退款金额', () => {
  const service = read('lib/activity-registration.ts')
  const register = read('app/api/activities/[activityId]/register/route.ts')

  assert.match(service, /if \(registration\.paidRegistrationFee > 0\)/)
  assert.match(service, /requestedAmount: registration\.paidRegistrationFee/)
  assert.doesNotMatch(service, /requestedAmount: activity\.registrationFee/)
  assert.match(register, /paidRegistrationFee: activity\.registrationFee/)
})

test('取消后的中奖资格计算为失效，开奖记录仍可在后台查看', () => {
  const lottery = read('lib/activity-lottery.ts')
  const manager = read('components/activities/ActivityLotteryManager.tsx')
  const state = getActivityLotteryWinnerRedemptionState({
    redemptionStatus: 'PENDING',
    registration: { status: 'ACTIVE', checkInSource: 'QR', checkedInAt: new Date('2026-09-01T10:00:00.000Z'), verifiedAt: new Date('2026-09-01T10:00:00.000Z') },
    activityEndAt: new Date('2026-09-01T12:00:00.000Z'),
    activityCancelled: true,
  })

  assert.equal(state, 'EXPIRED')
  assert.match(lottery, /Activity: \{ select: \{ status: true, endsAt: true \} \}/)
  assert.match(lottery, /status: \{ not: 'CANCELLED' \}/)
  assert.match(manager, /activityCancelled \|\| \(!activityEndAt/)
  assert.match(manager, /活动已取消/)
})

test('取消活动后的活动状态仍禁止报名，并提供只读历史脏数据审计入口', () => {
  const register = read('app/api/activities/[activityId]/register/route.ts')
  const shared = read('lib/activity-registration-shared.ts')
  const audit = read('scripts/audit-activity-cancellation-state.ts')
  const packageJson = read('package.json')
  const activityState = getActivityRegistrationState({ status: 'CANCELLED', registrationStartAt: null, registrationEndAt: null, signupLimit: null }, 10)

  assert.deepEqual(activityState, { state: 'CANCELLED', canRegister: false })
  assert.match(register, /activity\.status === 'CANCELLED'.*ACTIVITY_CANCELLED/)
  assert.match(shared, /if \(activity\.status !== 'PUBLISHED'\) return \{ state: 'CANCELLED', canRegister: false \}/)
  assert.match(audit, /readOnly: true/)
  assert.match(audit, /status: 'CANCELLED'/)
  assert.match(audit, /status: 'CANCELLED', verifiedAt: \{ not: null \}/)
  assert.match(audit, /cancelledVerifiedRegistrations/)
  assert.doesNotMatch(audit, /\.update\(|\.delete\(|\.deleteMany\(/)
  assert.match(packageJson, /activity:cancellation:audit/)
})

test('Schema 与迁移不因取消流程新增，历史报名仍保存取消事实', () => {
  const schema = read('prisma/schema.prisma')
  const service = read('lib/activity-registration.ts')

  assert.match(schema, /paidRegistrationFee\s+Int\s+@default\(0\)/)
  assert.match(schema, /status\s+ActivityRegistrationStatus\s+@default\(ACTIVE\)/)
  assert.match(schema, /cancelledAt\s+DateTime\?/) 
  assert.match(schema, /businessKey\s+String\?\s+@unique/)
  assert.match(service, /data: \{ status: 'CANCELLED', cancelledAt: now \}/)
})
