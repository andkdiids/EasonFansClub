import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Module from 'node:module'
import { after, before, test } from 'node:test'
import { hasValidActivityParticipation } from '@/lib/activity-participation'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const now = new Date('2026-09-01T05:00:00.000Z')
const end = new Date('2026-09-01T05:00:00.000Z')
const activeRegistration = { status: 'ACTIVE', verifiedAt: null, checkedInAt: null, checkInSource: null }

test('NONE 活动在结束时允许有效 ACTIVE 报名，未结束、无结束时间和取消报名均不允许', () => {
  assert.equal(hasValidActivityParticipation(activeRegistration, end, now, 'NONE', 'PUBLISHED'), true)
  assert.equal(hasValidActivityParticipation(activeRegistration, end, new Date('2026-09-01T04:59:59.999Z'), 'NONE', 'PUBLISHED'), false)
  assert.equal(hasValidActivityParticipation(activeRegistration, null, now, 'NONE', 'PUBLISHED'), false)
  assert.equal(hasValidActivityParticipation({ ...activeRegistration, status: 'CANCELLED' }, end, now, 'NONE', 'PUBLISHED'), false)
  assert.equal(hasValidActivityParticipation(activeRegistration, end, now, 'NONE', 'CANCELLED'), false)
})

test('MANUAL/QR 活动保持真实现场来源语义，并排除 AUTO_AFTER_ACTIVITY_END', () => {
  const manual = { status: 'ACTIVE', verifiedAt: new Date('2026-09-01T03:00:00.000Z'), checkedInAt: new Date('2026-09-01T03:00:00.000Z'), checkInSource: 'MANUAL' }
  const qr = { ...manual, checkInSource: 'QR' }
  const automatic = { ...manual, checkInSource: 'AUTO_AFTER_ACTIVITY_END' }
  assert.equal(hasValidActivityParticipation(manual, end, now, 'MANUAL', 'PUBLISHED'), true)
  assert.equal(hasValidActivityParticipation(qr, end, now, 'QR', 'PUBLISHED'), true)
  // Historical MANUAL/QR semantics accept either real check-in method.
  assert.equal(hasValidActivityParticipation(qr, end, now, 'MANUAL', 'PUBLISHED'), true)
  assert.equal(hasValidActivityParticipation(manual, end, now, 'QR', 'PUBLISHED'), true)
  assert.equal(hasValidActivityParticipation(automatic, end, now, 'MANUAL', 'PUBLISHED'), false)
  assert.equal(hasValidActivityParticipation(activeRegistration, end, now, 'MANUAL', 'PUBLISHED'), false)
})

test('缺失或未知模式不能回退到 NONE 无核销资格', () => {
  assert.equal(hasValidActivityParticipation(activeRegistration, end, now, null, 'PUBLISHED'), false)
  assert.equal(hasValidActivityParticipation(activeRegistration, end, now, 'UNKNOWN', 'PUBLISHED'), false)
})

test('扫描器、retention、legacy 自动核销和后台提示均使用同一分支口径', () => {
  const scanner = read('lib/activity-badge-rewards.ts')
  const retention = read('lib/badge-retention.ts')
  const registration = read('lib/activity-registration.ts')
  const manager = read('app/admin/badges/BadgeAdminManager.tsx')
  const rules = read('lib/badge-rules.ts')
  assert.match(scanner, /verificationMode: true/)
  assert.match(scanner, /activityVerificationMode !== 'NONE'/)
  assert.match(scanner, /hasValidActivityParticipation\(row, activityEndsAt, now, activityVerificationMode, activityStatus\)/)
  assert.match(scanner, /grantKey: `activity:\$\{plan\.activityId\}`/)
  assert.match(scanner, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(scanner, /FOR UPDATE/)
  assert.match(scanner, /grantBadgeWithTransaction\(tx/)
  assert.match(retention, /hasValidActivityParticipation\(registration, activity\.endsAt, now, activity\.verificationMode, activity\.status\)/)
  assert.match(registration, /activityParticipationEligible/)
  assert.match(registration, /if \(reward && !reward\.badgeGrantAt && activityParticipationEligible\)/)
  assert.match(registration, /AUTO_AFTER_ACTIVITY_END/)
  assert.match(manager, /无核销要求的活动在结束后由有效报名计入/)
  assert.match(rules, /无核销要求的活动在结束后以有效报名计入/)
  assert.match(rules, /活动结束自动核销不计入/)
})

type ServiceActivity = {
  id: string
  title: string
  status: string
  endsAt: Date | null
  verificationMode: string | null
}
type ServiceRegistration = {
  id: string
  activityId: string
  userId: string
  status: string
  verifiedAt: Date | null
  checkedInAt: Date | null
  checkInSource: string | null
}
type ServiceRegistrationWhere = {
  activityId?: string
  status?: string
  id?: string | { gt?: string }
  checkInSource?: { in?: readonly string[] }
  verifiedAt?: { not?: null }
}
type FakePrisma = {
  activityReward: { findMany: (input?: unknown) => Promise<[]> }
  badgeRule: { findMany: (input?: unknown) => Promise<Array<{ badgeId: string; configJson: { activityId: string }; Badge: { id: string; name: string } }>> }
  activity: {
    findMany: (input?: unknown) => Promise<ServiceActivity[]>
    findUnique: (input?: unknown) => Promise<ServiceActivity | null>
  }
  activityRegistration: {
    findMany: (input: { where: ServiceRegistrationWhere; take: number }) => Promise<ServiceRegistration[]>
    findUnique: (input?: unknown) => Promise<ServiceRegistration | null>
  }
  userBadge: { count: (input?: unknown) => Promise<number> }
  $transaction: <T>(callback: (tx: FakePrisma) => Promise<T>) => Promise<T>
  $queryRaw: (strings: TemplateStringsArray, ...values: readonly unknown[]) => Promise<Array<{ id: string }>>
}

const serviceNow = new Date('2026-09-01T06:00:00.000Z')
const serviceEnd = new Date('2026-09-01T05:00:00.000Z')
const loader = Module as unknown as { _load: (request: string, parent?: unknown, main?: boolean) => unknown }
const originalLoader = loader._load
let badgeService: typeof import('@/lib/activity-badge-rewards')
let state: {
  activity: ServiceActivity
  registration: ServiceRegistration | null
  rules: Array<{ badgeId: string; configJson: { activityId: string }; Badge: { id: string; name: string } }>
  grants: Set<string>
  grantCalls: number
  phase3Calls: number
  lockQueries: string[]
  beforeGrant: (() => void) | null
}

function resetServiceState(mode: string | null = 'MANUAL') {
  state = {
    activity: { id: 'activity-one', title: '测试活动', status: 'PUBLISHED', endsAt: serviceEnd, verificationMode: mode },
    registration: { id: 'registration-one', activityId: 'activity-one', userId: 'user-one', status: 'ACTIVE', verifiedAt: new Date('2026-09-01T04:00:00.000Z'), checkedInAt: new Date('2026-09-01T04:00:00.000Z'), checkInSource: 'MANUAL' },
    rules: [{ badgeId: 'badge-one', configJson: { activityId: 'activity-one' }, Badge: { id: 'badge-one', name: '活动徽章' } }],
    grants: new Set(),
    grantCalls: 0,
    phase3Calls: 0,
    lockQueries: [],
    beforeGrant: null,
  }
}

function currentRegistrationFields() {
  const registration = state.registration
  if (!registration) return null
  return { ...registration }
}

const fakePrisma: FakePrisma = {
  activityReward: { findMany: async () => [] },
  badgeRule: { findMany: async () => state.rules },
  activity: {
    findMany: async () => state.activity.status === 'PUBLISHED' ? [{ ...state.activity }] : [],
    findUnique: async () => ({ ...state.activity }),
  },
  activityRegistration: {
    findMany: async ({ where, take }: { where: ServiceRegistrationWhere; take: number }) => {
      const registration = state.registration
      if (!registration || registration.activityId !== where.activityId || registration.status !== where.status) return []
      if (typeof where.id === 'string' && registration.id !== where.id) return []
      if (where.id && typeof where.id === 'object' && typeof where.id.gt === 'string' && registration.id <= where.id.gt) return []
      if (where.checkInSource?.in && (!registration.checkInSource || !where.checkInSource.in.includes(registration.checkInSource))) return []
      if (where.verifiedAt?.not === null && registration.verifiedAt === null) return []
      const current = currentRegistrationFields()
      return current ? [current].slice(0, take) : []
    },
    findUnique: async () => currentRegistrationFields(),
  },
  userBadge: { count: async () => 0 },
  $transaction: async <T>(callback: (tx: FakePrisma) => Promise<T>) => {
    const beforeGrant = state.beforeGrant
    state.beforeGrant = null
    if (beforeGrant) beforeGrant()
    return callback(fakePrisma)
  },
  $queryRaw: async (strings: TemplateStringsArray) => {
    state.lockQueries.push(strings.join('?'))
    return [{ id: 'lock' }]
  },
}

before(async () => {
  resetServiceState()
  loader._load = function (request, parent, main) {
    if (request === '@/lib/prisma') return { prisma: fakePrisma }
    if (request === '@/lib/badge-validity') return { activeUserBadgeWhere: () => ({}) }
    if (request === '@/lib/badge-service') return {
      grantBadgeWithTransaction: async (_tx: unknown, input: { userId: string; badgeId: string; grantKey?: string | null }) => {
        state.grantCalls += 1
        const key = `${input.userId}:${input.badgeId}:${input.grantKey || ''}`
        const created = !state.grants.has(key)
        state.grants.add(key)
        return { created, alreadyOwned: !created, badgeId: input.badgeId, badgeName: '活动徽章', recordId: `record-${input.badgeId}`, userId: input.userId }
      },
    }
    if (request === '@/lib/badge-phase3' || /[/\\]badge-phase3(?:\.ts)?$/.test(request)) return { processBadgeGrantEffects: async () => { state.phase3Calls += 1 } }
    return originalLoader.call(this, request, parent, main)
  }
  badgeService = await import('@/lib/activity-badge-rewards')
})

after(() => { loader._load = originalLoader })

test('自动扫描在最终发放事务重新锁定并复核 ACTIVE 报名，重复 reconcile 保持幂等', async () => {
  resetServiceState('NONE')
  const first = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(first.granted, 1)
  assert.equal(first.eligibleRegistrations, 1)
  assert.equal(state.phase3Calls, 1)
  assert.match(state.lockQueries[0] || '', /Activity/)
  assert.match(state.lockQueries[1] || '', /ActivityRegistration/)

  const second = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(second.granted, 0)
  assert.equal(second.alreadyOwned, 1)
  assert.equal(second.eligibleRegistrations, 1)
  assert.equal(state.grantCalls, 2)
  assert.equal(state.phase3Calls, 1)

  resetServiceState('NONE')
  state.beforeGrant = () => { if (state.registration) state.registration.status = 'CANCELLED' }
  const cancelledBeforeGrant = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(cancelledBeforeGrant.granted, 0)
  assert.equal(cancelledBeforeGrant.eligibleRegistrations, 0)
  assert.equal(state.grantCalls, 0)

  resetServiceState('NONE')
  state.beforeGrant = () => { state.activity.status = 'CANCELLED' }
  const activityCancelledBeforeGrant = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(activityCancelledBeforeGrant.granted, 0)
  assert.equal(activityCancelledBeforeGrant.eligibleRegistrations, 0)
  assert.equal(state.grantCalls, 0)
})

test('活动结束后新增规则由周期扫描识别，缺报名和未知模式不会自动授予', async () => {
  resetServiceState('NONE')
  state.rules = []
  const beforeRule = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(beforeRule.scannedActivities, 0)
  assert.equal(beforeRule.granted, 0)

  state.rules = [{ badgeId: 'badge-one', configJson: { activityId: 'activity-one' }, Badge: { id: 'badge-one', name: '活动徽章' } }]
  const afterRule = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(afterRule.scannedActivities, 1)
  assert.equal(afterRule.granted, 1)

  resetServiceState('NONE')
  state.registration = null
  const withoutRegistration = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(withoutRegistration.granted, 0)
  assert.equal(withoutRegistration.eligibleRegistrations, 0)

  resetServiceState('UNKNOWN')
  const unknownMode = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(unknownMode.granted, 0)
  assert.equal(unknownMode.eligibleRegistrations, 0)
})

test('MANUAL/QR 规则只接受真实现场来源，AUTO_AFTER_ACTIVITY_END 不冒充现场', async () => {
  resetServiceState('MANUAL')
  const manual = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(manual.granted, 1)

  resetServiceState('QR')
  if (state.registration) {
    state.registration.checkInSource = 'QR'
    state.registration.verifiedAt = new Date('2026-09-01T04:00:00.000Z')
    state.registration.checkedInAt = new Date('2026-09-01T04:00:00.000Z')
  }
  const qr = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(qr.granted, 1)

  resetServiceState('MANUAL')
  if (state.registration) {
    state.registration.checkInSource = 'AUTO_AFTER_ACTIVITY_END'
    state.registration.verifiedAt = serviceNow
    state.registration.checkedInAt = serviceNow
  }
  const automatic = await badgeService.grantEligibleActivityBadges({ now: serviceNow })
  assert.equal(automatic.granted, 0)
  assert.equal(automatic.eligibleRegistrations, 0)
})
