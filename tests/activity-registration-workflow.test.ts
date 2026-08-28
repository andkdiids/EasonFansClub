import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  activityRegistrationSuccessNotificationKey,
  getActivityRegistrationState,
  parseRegistrationQuestions,
  validateRegistrationAnswers,
} from '@/lib/activity-registration'

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
  assert.match(cancel, /status: 'CANCELLED'/)
  assert.match(cancel, /verifiedAt/)
  assert.match(cancel, /syncActivitySignupCount\(tx, activityId\)/)
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
  assert.match(grant, /where: \{ userId_badgeId: \{ userId: input\.userId, badgeId: input\.badgeId \} \}/)
  assert.doesNotMatch(detail, /ActivityReward|限定勋章|rewardBadge/)
})

test('取消后重新报名不会从已取消记录回填旧答案', () => {
  const button = read('components/activities/ActivityRegistrationButton.tsx')
  assert.match(button, /initialRegistration\?\.status === 'ACTIVE'/)
  assert.match(button, /registration\?\.status === 'CANCELLED'\) setAnswers\(emptyAnswers\(questions\)\)/)
  assert.match(button, /setAnswers\(emptyAnswers\(questions\)\)/)
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
