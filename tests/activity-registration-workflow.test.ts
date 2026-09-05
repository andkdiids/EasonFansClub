import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  activityRegistrationSuccessNotificationKey,
  activityRegistrationVerificationWhere,
  activityVerificationTokenFromInput,
  getActivityRegistrationState,
  parseRegistrationQuestions,
  validateRegistrationAnswers,
} from '@/lib/activity-registration'
import { activityMaterialSchedule } from '@/lib/activity-material'
import { normalizeActivityInput } from '@/lib/activity-validation'
import { normalizeMaterialRules } from '@/lib/material-redemptions'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('报名表问题和答案由服务端统一校验，支持必填、单选、多选、文本和手机号', () => {
  const parsed = parseRegistrationQuestions([
    { id: 'question-name-1', title: '真实姓名', type: 'TEXT', required: true },
    { id: 'question-phone1', title: '联系电话', type: 'PHONE', required: true },
    { id: 'question-size-1', title: '尺码', type: 'SINGLE_SELECT', required: true, options: [{ label: 'L', value: 'L' }, { label: 'XL', value: 'XL' }] },
    { id: 'question-tags1', title: '兴趣', type: 'MULTI_SELECT', options: [{ label: '音乐', value: 'music' }, { label: '现场', value: 'live' }] },
  ])
  assert.equal(parsed.valid, true)
  if (!parsed.valid) return
  const questions = parsed.value.map((question) => ({ ...question, id: question.id || 'generated-id' }))
  const answers = validateRegistrationAnswers(questions, {
    'question-name-1': '陈先生',
    'question-phone1': '13800138000',
    'question-size-1': 'L',
    'question-tags1': ['music', 'live'],
  })
  assert.equal(answers.valid, true)
  if (answers.valid) assert.equal(answers.value.length, 4)
  assert.equal(validateRegistrationAnswers(questions, { 'question-size-1': 'XXL' }).valid, false)
  assert.equal(validateRegistrationAnswers(questions, { 'question-name-1': '陈先生', 'question-phone1': 'abc' }).valid, false)
})

test('报名窗口独立于活动时间，空值不制造隐含截止时间', () => {
  const activity = { status: 'PUBLISHED' as const, startsAt: '2026-08-10T00:00:00.000Z', endsAt: '2026-08-10T01:00:00.000Z', registrationStartAt: null, registrationEndAt: null, signupLimit: null }
  assert.deepEqual(getActivityRegistrationState(activity, 0, new Date('2026-08-20T00:00:00.000Z')), { state: 'AVAILABLE', canRegister: true })
  const withLegacyPublishedAt = { ...activity, publishedAt: '2026-08-30T00:00:00.000Z' } as Parameters<typeof getActivityRegistrationState>[0]
  assert.deepEqual(getActivityRegistrationState(withLegacyPublishedAt, 0, new Date('2026-08-20T00:00:00.000Z')), { state: 'AVAILABLE', canRegister: true })
  assert.deepEqual(getActivityRegistrationState({ ...activity, registrationStartAt: '2026-08-25T00:00:00.000Z' }, 0, new Date('2026-08-20T00:00:00.000Z')), { state: 'NOT_STARTED', canRegister: false })
  assert.deepEqual(getActivityRegistrationState({ ...activity, registrationEndAt: '2026-08-25T00:00:00.000Z' }, 0, new Date('2026-08-25T00:00:00.000Z')), { state: 'CLOSED', canRegister: false })
})

test('每次真实报名生命周期使用独立通知 key，重试仍由有效报名短路', () => {
  const first = activityRegistrationSuccessNotificationKey('activity-1', 'user-1', 'registration-1', 'life-1')
  const retry = activityRegistrationSuccessNotificationKey('activity-1', 'user-1', 'registration-1', 'life-1')
  const rejoined = activityRegistrationSuccessNotificationKey('activity-1', 'user-1', 'registration-1', 'life-2')
  const route = read('app/api/activities/[activityId]/register/route.ts')
  assert.equal(first, retry)
  assert.notEqual(first, rejoined)
  assert.match(first, /activity-registration-success:activity-1:user-1:registration-1:life-1/)
  assert.match(route, /generateActivityRegistrationLifecycleKey\(\)/)
  assert.match(route, /existing\?\.status === 'ACTIVE'/)
  assert.match(route, /const notificationKey = activityRegistrationSuccessNotificationKey\(activityId, guard\.user\.id, registration\.id, lifecycleKey\)/)
})

test('报名、取消、答案和通知在同一事务；活动行锁保证名额串行化', () => {
  const route = read('app/api/activities/[activityId]/register/route.ts')
  const cancel = read('app/api/activities/[activityId]/register/cancel/route.ts')
  const service = read('lib/activity-registration.ts')
  assert.match(route, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(route, /SELECT[\s\S]*Activity[\s\S]*FOR UPDATE/)
  assert.match(route, /body\.confirm !== true/)
  assert.match(route, /activityRegistrationAnswer\.createMany/)
  assert.match(route, /upsertNotificationWithDb/)
  assert.match(cancel, /cancelActivityRegistration\(\{ activityId, userId: guard\.user\.id, source: 'USER' \}\)/)
  assert.match(service, /status: 'CANCELLED'/)
  assert.match(service, /verifiedAt/)
  assert.match(service, /syncActivitySignupCount\(tx, activity\.id\)/)
  assert.match(service, /where: \{ activityId, status: 'ACTIVE' \}/)
  assert.match(route, /activityRegistrationAnswer\.deleteMany\(\{ where: \{ registrationId: registration\.id \} \}\)/)
})

test('后台报名管理严格鉴权，前台只返回本人报名，核销重复请求幂等', () => {
  const publicRoute = read('app/api/activities/[activityId]/route.ts')
  const adminList = read('app/api/admin/activities/[activityId]/registrations/route.ts')
  const verify = read('lib/activity-registration.ts')
  assert.match(publicRoute, /activityRegistration\.findUnique\(\{ where: \{ activityId_userId: \{ activityId, userId: viewer\.id \}/)
  assert.match(publicRoute, /registration: registration \? serializeActivityRegistration\(registration\) : null/)
  assert.match(adminList, /requireAdmin\('activity_manage'\)/)
  assert.doesNotMatch(adminList, /verificationToken/)
  assert.match(verify, /if \(current\.verifiedAt\) return \{ alreadyVerified: true/)
  assert.match(verify, /verificationMethod: input\.method/)
})

test('限定奖励只在核销事务内复用统一勋章服务，前台不返回奖励配置', () => {
  const service = read('lib/activity-registration.ts')
  const detail = read('components/activities/ActivityDetailView.tsx')
  const grant = read('lib/badge-service.ts')
  assert.match(service, /grantBadgeWithTransaction\(tx/)
  assert.match(service, /sourceType: 'ACTIVITY_VERIFICATION'/)
  assert.match(service, /grantReason: `活动「\$\{activity\.title\}」完成现场核销`/)
  assert.match(service, /registrationId: current\.id, rewardId/)
  assert.match(grant, /activeUserBadgeWhere/)
  assert.match(service, /grantKey: `activity-registration:\$\{current\.id\}/)
  assert.doesNotMatch(detail, /ActivityReward|限定勋章|rewardBadge/)
})

test('取消后永久禁止再次报名并且不回填已取消记录的旧答案', () => {
  const button = read('components/activities/ActivityRegistrationButton.tsx')
  assert.match(button, /initialRegistration\?\.status === 'ACTIVE'/)
  assert.match(button, /setAnswers\(emptyAnswers\(questions\)\)/)
  assert.match(button, /initialRegistration\?\.status !== 'CANCELLED'/)
  assert.match(button, /isCancelled/)
  assert.doesNotMatch(button, /取消后仍可在报名时间内重新报名/)
})

test('报名状态服务不读取发布或活动开始/结束时间作为报名窗口兜底', () => {
  const shared = read('lib/activity-registration-shared.ts')
  const route = read('app/api/activities/[activityId]/register/route.ts')
  assert.doesNotMatch(shared, /timestamp\(activity\.publishedAt\)/)
  assert.doesNotMatch(route, /publishedAt: true/)
  assert.doesNotMatch(shared, /activity\.startsAt|activity\.endsAt/)
})

test('活动封面、详情排版和数据库增量迁移覆盖移动端验收约束', () => {
  const card = read('components/activities/ActivityCard.tsx')
  const list = read('components/activities/ActivitiesListClient.tsx')
  const detail = read('components/activities/ActivityDetailView.tsx')
  const migration = read('prisma/migrations/20260828160000_add_activity_registration_workflow/migration.sql')
  assert.match(card, /aspect-\[3\/4\]/)
  assert.match(card, /object-cover/)
  assert.match(list, /grid-cols-2/)
  assert.match(detail, /object-contain/)
  assert.match(migration, /CREATE TABLE `ActivityRegistrationQuestion`/)
  assert.match(migration, /CREATE TABLE `ActivityRegistrationAnswer`/)
  assert.match(migration, /CREATE TABLE `ActivityReward`/)
})

test('活动详情桌面端使用三栏约束，已核销二维码保留但明确置灰', () => {
  const page = read('app/activities/[activityId]/page.tsx')
  const detail = read('components/activities/ActivityDetailView.tsx')
  const registration = read('components/activities/ActivityRegistrationButton.tsx')
  const qr = read('components/activities/ActivityRegistrationQr.tsx')

  assert.match(page, /max-w-\[1440px\]/)
  assert.match(page, /maxWidth: '1440px'/)
  assert.match(detail, /items-start/)
  assert.match(detail, /lg:grid-cols-\[340px_minmax\(0,1fr\)_320px\]/)
  assert.match(detail, /xl:grid-cols-\[380px_minmax\(0,1fr\)_340px\]/)
  assert.match(detail, /lg:contents/)
  assert.match(detail, /lg:max-w-\[360px\]/)
  assert.match(detail, /self-start h-auto/)
  assert.match(detail, /object-contain/)
  assert.match(registration, /verifiedAt=\{registration\.verifiedAt\}/)
  assert.match(qr, /Boolean\(verifiedAt\)/)
  assert.match(qr, /overflow-hidden/)
  assert.match(qr, /lg:max-w-\[300px\]/)
  assert.match(qr, /pointer-events-none grayscale opacity-40/)
  assert.match(qr, /已核销/)
})

test('收费活动和活动物料规则使用新增字段，物料时间继承活动实际起止时间', () => {
  const activity = normalizeActivityInput({
    title: '收费活动',
    type: 'OFFLINE',
    status: 'PUBLISHED',
    startsAt: '2026-09-13T18:00',
    endsAt: '2026-09-13T21:00',
    description: '活动说明',
    registrationFee: 27,
    feeDescription: '报名费用包含活动物料。',
    linkedMaterialId: 'material-1',
  })
  assert.equal(activity.valid, true)
  if (activity.valid) {
    assert.equal(activity.value.registrationFee, 27)
    assert.equal(activity.value.feeDescription, '报名费用包含活动物料。')
    assert.equal(activity.value.linkedMaterialId, 'material-1')
  }
  const rules = normalizeMaterialRules([{ type: 'ACTIVITY_REGISTRATION_REQUIRED', operator: 'EQ', value: 'activity-1' }])
  assert.deepEqual(rules, { rules: [{ type: 'ACTIVITY_REGISTRATION_REQUIRED', operator: 'EQ', value: 'activity-1' }] })
  const schedule = activityMaterialSchedule(new Date('2026-09-13T10:00:00.000Z'), new Date('2026-09-13T13:00:00.000Z'))
  assert.deepEqual(schedule, {
    exchangeStartAt: new Date('2026-09-13T10:00:00.000Z'),
    exchangeEndAt: new Date('2026-09-13T13:00:00.000Z'),
    redeemEndAt: new Date('2026-09-13T13:00:00.000Z'),
  })
})

test('报名费用、自动物料库存和自动订单在同一事务内且只收一次费用', () => {
  const route = read('app/api/activities/[activityId]/register/route.ts')
  const service = read('lib/activity-registration.ts')
  const schema = read('prisma/schema.prisma')
  assert.match(route, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(route, /consumeRegistrationFee\(tx, \{[\s\S]*action: 'ACTIVITY_REGISTRATION_FEE'/)
  assert.match(route, /createActivityMaterialOrderInTransaction\(tx, \{[\s\S]*materialId: activity\.linkedMaterial\.id/)
  assert.match(service, /activityMaterialOrderIdempotencyPrefix = 'activity-registration-material:'/)
  assert.match(service, /const idempotencyKey = `\$\{activityMaterialOrderIdempotencyPrefix\}\$\{input\.registrationId\}`/)
  assert.match(service, /stockRemaining: \{ gte: 1 \}/)
  assert.match(service, /if \(stockChanged\.count !== 1\)/)
  assert.match(service, /source: 'ACTIVITY_REGISTRATION_AUTO'/)
  assert.match(service, /unitCost: 0[\s\S]*totalCost: 0/)
  assert.match(schema, /idempotencyKey\s+String\s+@unique/)
  assert.match(schema, /paidRegistrationFee\s+Int\s+@default\(0\)/)
})

test('取消报名按实际支付金额退款、同步取消活动物料并永久保留取消事实', () => {
  const cancel = read('app/api/activities/[activityId]/register/cancel/route.ts')
  const service = read('lib/activity-registration.ts')
  const button = read('components/activities/ActivityRegistrationButton.tsx')
  assert.match(service, /status === 'CANCELLED'/)
  assert.match(service, /paidRegistrationFee/)
  assert.match(service, /action: 'ACTIVITY_REGISTRATION_REFUND'/)
  assert.match(service, /businessKey: `activity-registration-refund:\$\{registration\.id\}`/)
  assert.match(service, /status: 'CANCELLED'/)
  assert.match(service, /stockRemaining: \{ lte:/)
  assert.match(service, /status: 'CANCELLED', cancelledAt: now/)
  assert.match(cancel, /cancelActivityRegistration\(/)
  assert.doesNotMatch(cancel, /activityRegistration\.delete|tx\.activityRegistration\.delete/)
  assert.match(button, /cancelDialogOpen/)
  assert.match(button, /确认取消报名/)
  assert.match(button, /initialRegistration\?\.status !== 'CANCELLED'/)
  assert.match(button, /无法再次报名/)
})

test('取消报名只受报名结束时间约束，后端事务和前端均拒绝截止后操作', () => {
  const cancel = read('app/api/activities/[activityId]/register/cancel/route.ts')
  const service = read('lib/activity-registration.ts')
  const button = read('components/activities/ActivityRegistrationButton.tsx')
  const shared = read('lib/activity-registration-shared.ts')
  const cancellationService = service.slice(service.indexOf('export type ActivityRegistrationCancellationSource'), service.indexOf('export async function syncActivityRegistrationQuestions'))
  assert.match(cancellationService, /registrationEndAt: true/)
  assert.match(cancellationService, /isActivityRegistrationCancellationOpen\(activity, now\)/)
  assert.match(cancellationService, /ACTIVITY_REGISTRATION_CANCEL_CLOSED/)
  assert.match(cancellationService, /activityRegistrationCancelClosedMessage/)
  assert.match(shared, /活动报名已结束，无法取消报名。/)
  assert.match(cancellationService, /registration\.status !== 'ACTIVE'/)
  assert.match(cancellationService, /order\.status === 'REDEEMED'/)
  assert.doesNotMatch(cancellationService, /activity\.startsAt|activity\.endsAt/)
  const lockedCancellation = cancellationService.slice(cancellationService.indexOf('async function cancelActivityRegistrationLockedInTransaction'))
  assert.ok(lockedCancellation.indexOf('ACTIVITY_REGISTRATION_CANCEL_CLOSED') < lockedCancellation.indexOf('awardRegistrationFee'))
  assert.ok(lockedCancellation.indexOf('ACTIVITY_REGISTRATION_CANCEL_CLOSED') < lockedCancellation.indexOf('cancelLinkedActivityMaterialInTransaction'))
  assert.match(cancel, /source: 'USER'/)
  assert.match(button, /isActivityRegistrationCancellationOpen\(activity, new Date\(now\)\)/)
  assert.match(button, /ACTIVITY_REGISTRATION_CANCEL_CLOSED/)
  assert.match(button, /activityRegistrationCancelClosedMessage/)
  assert.match(button, /绑定活动物料已核销，无法取消报名。/)
  assert.doesNotMatch(button, /canCancelByTime = .*activity\.startsAt|canCancelByTime = .*activity\.endsAt/)
})

test('活动码和物料码共享同一联动核销事务，重复扫码不会重复核销', () => {
  const registration = read('lib/activity-registration.ts')
  const material = read('lib/material-redemptions.ts')
  const activityVerify = read('app/api/admin/activities/[activityId]/verify/route.ts')
  const materialVerify = read('app/api/admin/material-redemptions/verify/route.ts')
  assert.match(registration, /redeemLinkedMaterialInTransaction/)
  assert.match(registration, /redemptionSource: 'ACTIVITY_CHECK_IN'/)
  assert.match(registration, /if \(current\.verifiedAt\) return \{ alreadyVerified: true/)
  assert.match(material, /verifyActivityRegistrationInTransaction\(tx, \{ activityId, registrationId, adminId, method: 'MANUAL', allowLinkedMaterial: true \}/)
  assert.match(material, /if \(order\.status === 'REDEEMED'\)[\s\S]*ACTIVITY_REGISTRATION_AUTO/)
  assert.match(material, /source === 'ACTIVITY_REGISTRATION_AUTO'/)
  assert.match(activityVerify, /getActivityRedemptionLookup\(/)
  assert.match(activityVerify, /scanOnly: true/)
  assert.doesNotMatch(activityVerify, /verifyActivityRegistration\(/)
  assert.match(read('app/api/admin/activities/[activityId]/redemption-confirm/route.ts'), /confirmActivityRedemption\(/)
  assert.match(materialVerify, /redeemMaterialOrder\(/)
  assert.match(registration, /where: \{ id: order\.id, status: 'SUCCESS' \}/)
})

test('活动结束自动核销只扫描未核销的有效报名，服务进程提供幂等补偿触发', () => {
  const registration = read('lib/activity-registration.ts')
  const server = read('server.ts')
  const jobRoute = read('app/api/internal/daily-jobs/activity-auto-checkin/route.ts')
  assert.match(registration, /status: 'ACTIVE'/)
  assert.match(registration, /verifiedAt: null/)
  assert.match(registration, /endsAt: \{ lt: now \}/)
  assert.match(registration, /checkInSource: 'AUTO_AFTER_ACTIVITY_END'/)
  assert.match(registration, /ACTIVITY_AUTO_CHECK_IN/)
  assert.match(registration, /if \(registration\.verifiedAt\) return \{ processed: false, reason: 'ALREADY_VERIFIED'/)
  assert.match(server, /activityAutoCheckInIntervalMs/)
  assert.match(server, /autoCheckInEndedActivityRegistrations/)
  assert.match(jobRoute, /x-daily-job-secret/)
  assert.match(jobRoute, /autoCheckInEndedActivityRegistrations/)
})

test('活动与物料前台明确区分自动兑换来源，活动物料不出现普通兑换入口', () => {
  const activityDetail = read('components/activities/ActivityDetailView.tsx')
  const materialList = read('app/material-redemptions/MaterialRedemptionsClient.tsx')
  const materialDetail = read('app/material-redemptions/[materialId]/MaterialRedemptionDetailClient.tsx')
  const adminMaterial = read('app/admin/material-redemptions/MaterialRedemptionAdminManager.tsx')
  assert.match(activityDetail, /报名福利/)
  assert.match(activityDetail, /无需重复扫码/)
  assert.match(materialList, /活动限定/)
  assert.match(materialDetail, /前往活动报名/)
  assert.match(materialDetail, /!material\.isActivityBound/)
  assert.match(adminMaterial, /需报名指定活动/)
  assert.match(adminMaterial, /报名时自动兑换/)
})

test('活动物料核销遵守活动实际开始时间，活动结束后仍由自动联动流程处理', () => {
  const material = read('lib/material-redemptions.ts')
  const registration = read('lib/activity-registration.ts')
  const button = read('components/activities/ActivityRegistrationButton.tsx')
  const adminMaterial = read('app/admin/material-redemptions/MaterialRedemptionAdminManager.tsx')
  assert.match(material, /const notStarted = activityBound && order\.status === 'SUCCESS' && now < effectiveSchedule\.exchangeStartAt/)
  assert.match(material, /ACTIVITY_NOT_STARTED/)
  assert.match(registration, /current\.LinkedMaterialRedemption\?\.source === 'ACTIVITY_REGISTRATION_AUTO'/)
  assert.match(registration, /now < activity\.startsAt/)
  assert.match(button, /activity\.registrationEndAt/)
  assert.match(adminMaterial, /verifyPreview\.notStarted \? '活动尚未开始'/)
})

test('删除草稿活动前阻止遗留活动物料绑定', () => {
  const route = read('app/api/admin/activities/[activityId]/route.ts')
  assert.match(route, /linkedMaterial: \{ select: \{ id: true, title: true \} \}/)
  assert.match(route, /activity\.linkedMaterial/)
  assert.match(route, /请先解除绑定后再删除/)
})

test('活动物料历史订单的兑换时间优先继承订单关联活动', () => {
  const material = read('lib/material-redemptions.ts')
  assert.match(material, /function materialOrderSchedule\(order: Pick<MaterialOrderWithRelations, 'material' \| 'linkedActivity'>\)/)
  assert.match(material, /if \(order\.linkedActivity\)[\s\S]*activityMaterialSchedule\(order\.linkedActivity\.startsAt, order\.linkedActivity\.endsAt\)/)
  assert.match(material, /const schedule = materialOrderSchedule\(order\)/)
})

test('活动核销码和活动二维码使用统一的精确解析与活动绑定条件', () => {
  const code = ' \n ecfc-59939b58f48a\r\n '
  assert.equal(activityVerificationTokenFromInput(code), 'ECFC-59939B58F48A')

  const activityToken = 'ActivityQrToken-AbC123'
  assert.equal(
    activityVerificationTokenFromInput(`https://ecfc.fans/admin/activities/activity-a/verify?token=${encodeURIComponent(activityToken)}`),
    activityToken,
  )

  const where = activityRegistrationVerificationWhere('activity-a', code)
  const serialized = JSON.stringify(where)
  assert.match(serialized, /activity-a/)
  assert.match(serialized, /verificationToken/)
  assert.match(serialized, /redeemCode/)
  assert.match(serialized, /ECFC-59939B58F48A/)
  assert.match(serialized, /EFC-59939B58F48A/)
  assert.match(serialized, /linkedActivityId/)
})

test('统一活动核销查询由服务端直接按令牌解析，手动输入和扫码不依赖分页列表', () => {
  const redemption = read('lib/activity-redemption.ts')
  const manager = read('components/activities/ActivityRegistrationManager.tsx')
  const lookupRoute = read('app/api/admin/activities/[activityId]/verify/route.ts')
  assert.match(redemption, /export async function resolveActivityVerificationToken/)
  assert.match(redemption, /activityRegistrationVerificationWhere\(activityId, token\)/)
  assert.match(redemption, /resolveActivityVerificationToken\(tx, activityId, token\)/)
  assert.match(lookupRoute, /getActivityRedemptionLookup\(activityId, token\)/)
  assert.match(manager, /void verifyToken\(token\)/)
  assert.match(manager, /onScan=\{\(value\) => void verifyToken\(value\)\}/)
  assert.doesNotMatch(manager, /registrations\.find\(/)
})
