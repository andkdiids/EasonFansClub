import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeActivityInput } from '@/lib/activity-validation'
import { getActivityRegistrationState } from '@/lib/activity-registration'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

function publishedActivity(overrides: Record<string, unknown> = {}) {
  return {
    title: '粉丝线下聚会',
    type: 'OFFLINE',
    status: 'PUBLISHED',
    startsAt: '2026-09-01T10:00',
    endsAt: '2026-09-01T18:00',
    description: '这是活动说明。',
    ...overrides,
  }
}

test('活动正式发布只要求标题、类型、开始/结束时间和说明', () => {
  const result = normalizeActivityInput(publishedActivity())
  assert.equal(result.valid, true)
  if (!result.valid) return
  assert.equal(result.value.subtitle, null)
  assert.equal(result.value.coverUrl, null)
  assert.equal(result.value.locationName, null)
  assert.equal(result.value.locationAddress, null)
  assert.equal(result.value.onlineUrl, null)
  assert.equal(result.value.signupLimit, null)
  assert.equal(result.value.registrationStartAt, null)
  assert.equal(result.value.registrationEndAt, null)
  assert.equal(result.value.organizer, null)
  assert.equal(result.value.contactInfo, null)
  assert.equal(result.value.isFeatured, false)
  assert.equal(result.value.isPinned, false)
  assert.equal(result.value.sortOrder, 0)
})

test('正式发布的必填校验给出逐项提示，可选字段为空不会阻断', () => {
  const cases = [
    [{ ...publishedActivity(), title: '' }, '请填写活动标题'],
    [Object.fromEntries(Object.entries(publishedActivity()).filter(([key]) => key !== 'type')), '请选择活动类型'],
    [{ ...publishedActivity(), type: '' }, '请选择活动类型'],
    [{ ...publishedActivity(), startsAt: '' }, '请选择活动开始时间'],
    [{ ...publishedActivity(), endsAt: '' }, '请选择活动结束时间'],
    [{ ...publishedActivity(), description: '' }, '请填写活动说明'],
  ] as const
  for (const [input, message] of cases) {
    const result = normalizeActivityInput(input)
    assert.equal(result.valid, false)
    if (!result.valid) assert.equal(result.message, message)
  }
  assert.equal(normalizeActivityInput({ title: '先存起来', status: 'DRAFT' }).valid, true)
})

test('活动时间关系包含活动时段和报名窗口限制', () => {
  const activityEndBeforeStart = normalizeActivityInput(publishedActivity({ endsAt: '2026-09-01T09:00' }))
  assert.equal(activityEndBeforeStart.valid, false)
  if (!activityEndBeforeStart.valid) assert.equal(activityEndBeforeStart.message, '结束时间必须晚于开始时间')

  const signupEndBeforeStart = normalizeActivityInput(publishedActivity({ registrationStartAt: '2026-08-20T10:00', registrationEndAt: '2026-08-20T09:00' }))
  assert.equal(signupEndBeforeStart.valid, false)
  if (!signupEndBeforeStart.valid) assert.equal(signupEndBeforeStart.message, '报名结束时间必须晚于报名开始时间')

  const signupAfterActivity = normalizeActivityInput(publishedActivity({ registrationEndAt: '2026-09-01T19:00' }))
  assert.equal(signupAfterActivity.valid, false)
  if (!signupAfterActivity.valid) assert.equal(signupAfterActivity.message, '报名结束时间不能晚于活动结束时间')
})

test('报名状态统一处理开始时间、截止时间、结束状态和名额', () => {
  const base = {
    status: 'PUBLISHED' as const,
    publishedAt: '2026-08-01T00:00:00.000Z',
    startsAt: '2026-09-01T02:00:00.000Z',
    endsAt: '2026-09-01T10:00:00.000Z',
    signupLimit: null,
  }
  assert.deepEqual(getActivityRegistrationState({ ...base, registrationStartAt: '2026-08-25T00:00:00.000Z' }, 0, new Date('2026-08-20T00:00:00.000Z')), { state: 'NOT_STARTED', canRegister: false })
  assert.deepEqual(getActivityRegistrationState(base, 0, new Date('2026-08-20T00:00:00.000Z')), { state: 'AVAILABLE', canRegister: true })
  assert.deepEqual(getActivityRegistrationState({ ...base, signupLimit: 2 }, 2, new Date('2026-08-20T00:00:00.000Z')), { state: 'FULL', canRegister: false })
  assert.deepEqual(getActivityRegistrationState({ ...base, signupLimit: 0 }, 999, new Date('2026-08-20T00:00:00.000Z')), { state: 'AVAILABLE', canRegister: true })
  assert.deepEqual(getActivityRegistrationState(base, 0, new Date('2026-09-01T10:00:00.000Z')), { state: 'ENDED', canRegister: false })
})

test('活动报名复用既有唯一模型，事务锁住活动并幂等写入通知', () => {
  const schema = read('prisma/schema.prisma')
  const route = read('app/api/activities/[activityId]/register/route.ts')
  const registration = read('lib/activity-registration.ts')
  const detailApi = read('app/api/activities/[activityId]/route.ts')
  assert.match(schema, /model ActivityRegistration/)
  assert.match(schema, /@@unique\(\[activityId, userId\]\)/)
  assert.match(route, /FOR UPDATE/)
  assert.match(route, /activityRegistration\.create/)
  assert.match(route, /upsertNotificationWithDb/)
  assert.match(registration, /activity-registration-success:/)
  assert.match(route, /new ActivityRegistrationError\([^\n]+, 409\)/)
  assert.match(route, /link: `\/activities\/\$\{activityId\}`/)
  assert.match(detailApi, /registrationCount/)
  assert.match(detailApi, /isRegistered/)
  assert.match(detailApi, /canRegister/)
})

test('活动列表和首页一次带回真实报名数量，卡片封面固定为竖版 3:4', () => {
  const data = read('lib/activity-data.ts')
  const home = read('lib/home-data.ts')
  const card = read('components/activities/ActivityCard.tsx')
  assert.match(data, /_count: \{ select: \{ ActivityRegistration: true \} \}/)
  assert.match(data, /signupCount: _count\.ActivityRegistration/)
  assert.match(home, /_count: \{ select: \{ ActivityRegistration: true \} \}/)
  assert.match(home, /signupCount: _count\.ActivityRegistration/)
  assert.match(card, /aspect-\[3\/4\]/)
  assert.match(card, /object-cover/)
  assert.match(card, /报名：\$\{activity\.signupCount\}人/)
})

test('详情页报名不再把线上链接当作报名入口，白天模式使用主题变量', () => {
  const detail = read('components/activities/ActivityDetailView.tsx')
  const page = read('app/activities/[activityId]/page.tsx')
  assert.match(detail, /ActivityRegistrationButton/)
  assert.match(detail, /打开活动链接/)
  assert.match(detail, /normalizeActionUrl/)
  assert.doesNotMatch(detail, /立即报名.*onlineUrl/)
  assert.match(detail, /var\(--foreground\)/)
  assert.match(detail, /var\(--surface-elevated\)/)
  assert.match(page, /getCurrentUser/)
  assert.match(page, /activityRegistration\.findUnique/)
})

test('后台草稿保持宽松，正式发布由自定义校验返回明确错误', () => {
  const manager = read('app/admin/activities/ActivityAdminManager.tsx')
  assert.match(manager, /noValidate/)
  assert.match(manager, /publishValidationMessage/)
  assert.match(manager, /placeholder="可选，仅作为活动资料"/)
  assert.doesNotMatch(manager, /线上活动必填/)
})
