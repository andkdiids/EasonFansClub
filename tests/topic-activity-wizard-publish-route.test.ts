import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { TopicLotteryError } from '@/lib/topic-activity-v2-lottery-config'

const loader = Module as unknown as { _load: (request: string, parent?: unknown, main?: boolean) => unknown }
const originalLoad = loader._load

type Activity = Record<string, unknown> & {
  id: string
  status: string
  type: string
  startsAt: Date
  endsAt: Date
}
type Route = typeof import('../app/api/admin/activities/[activityId]/route')

class MockActivityConfigurationError extends Error {}
class MockActivityRegistrationError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message) }
}
class MockActivityMaterialConfigurationError extends Error {}

let route: Route
let authenticated = false
let legacyLottery: Record<string, unknown> | null = null
let topicWindowError: Error | null = null
let current: Activity
let transactionActivity: Activity
let updateCalls: Array<Record<string, unknown>> = []
let legacyLotteryQueries: Array<Record<string, unknown>> = []
let events: string[] = []

const denied = (status: number) => ({ user: null, response: new Response('{}', { status }) })

const makeActivity = (overrides: Partial<Activity> = {}): Activity => ({
  id: 'activity-one',
  title: '天使的礼物',
  subtitle: null,
  description: '分享活动',
  type: 'TOPIC_ACTIVITY',
  status: 'DRAFT',
  coverUrl: null,
  bannerUrl: null,
  locationName: null,
  locationAddress: null,
  onlineUrl: null,
  registrationFee: 0,
  feeDescription: null,
  linkedMaterialId: null,
  linkedMaterial: null,
  startsAt: new Date('2026-10-20T00:00:00.000Z'),
  endsAt: new Date('2026-10-30T00:00:00.000Z'),
  registrationStartAt: new Date('2026-10-20T00:00:00.000Z'),
  registrationEndAt: new Date('2026-10-30T00:00:00.000Z'),
  verificationMode: 'NONE',
  signupLimit: null,
  organizer: '私家E院',
  contactInfo: null,
  isFeatured: false,
  isPinned: false,
  sortOrder: 0,
  publishedAt: null,
  pinToPlaza: false,
  participationRule: '发布活动相关内容并上传截图',
  participationMode: 'COMMENT',
  allowImageAttachments: true,
  formSchema: null,
  rewardGrantMode: 'IMMEDIATE',
  rewardGrantAt: null,
  rewardPoints: null,
  rewardBadgeIds: [],
  ...overrides,
})

const cloneActivity = (value: Activity): Activity => ({ ...value })

const request = (body: unknown, headers: Record<string, string> = {}) => new Request('http://localhost/api/admin/activities/activity-one', {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

const context = { params: Promise.resolve({ activityId: 'activity-one' }) }

before(async () => {
  loader._load = function (requestName, parent, main) {
    if (requestName === 'next/cache') return { revalidatePath: () => undefined }
    if (requestName === '@/lib/security') return {
      requireAdmin: async () => authenticated ? { user: { id: 'admin' }, response: null } : denied(401),
      rejectInvalidRequestOrigin: (req: Request) => req.headers.get('origin') === 'https://hostile.invalid' ? new Response('{}', { status: 403 }) : null,
    }
    if (requestName === '@/lib/activity-data') return {
      activitySelect: {},
      serializeActivityRow: (activity: Activity) => activity,
    }
    if (requestName === '@/lib/admin-audit') return {
      adminAuditOperations: {
        ACTIVITY_PUBLISH: 'ACTIVITY_PUBLISH',
        ACTIVITY_CANCEL: 'ACTIVITY_CANCEL',
        ACTIVITY_UNPUBLISH: 'ACTIVITY_UNPUBLISH',
        ACTIVITY_UPDATE: 'ACTIVITY_UPDATE',
        ACTIVITY_FORM_UPDATE: 'ACTIVITY_FORM_UPDATE',
        ACTIVITY_REWARD_UPDATE: 'ACTIVITY_REWARD_UPDATE',
      },
      createAdminActionAudit: async () => undefined,
    }
    if (requestName === '@/lib/content-moderation') return {
      checkBannedWords: async () => ({ blocked: false }),
      CONTENT_CONTAINS_BANNED_WORD: 'CONTENT_CONTAINS_BANNED_WORD',
      BANNED_WORD_MESSAGE: '内容包含敏感词',
    }
    if (requestName === '@/lib/activity-validation') return {
      normalizeActivityInput: (body: unknown, existing: Record<string, unknown>) => {
        const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
        return {
          valid: true,
          value: {
            ...existing,
            ...input,
            type: typeof input.type === 'string' ? input.type : existing.type,
            status: typeof input.status === 'string' ? input.status : existing.status,
            startsAt: existing.startsAt,
            endsAt: existing.endsAt,
          },
        }
      },
    }
    if (requestName === '@/lib/activity-registration') return {
      ActivityConfigurationError: MockActivityConfigurationError,
      ActivityRegistrationError: MockActivityRegistrationError,
      cancelActivityInTransaction: async () => null,
      getActivityRegistrationQuestions: async () => [],
      syncActivityRegistrationQuestions: async () => undefined,
      syncActivityReward: async () => undefined,
    }
    if (requestName === '@/lib/activity-material') return {
      ActivityMaterialConfigurationError: MockActivityMaterialConfigurationError,
      syncActivityLinkedMaterial: async () => undefined,
    }
    if (requestName === '@/lib/activity-badge-rewards') return { grantEligibleActivityBadges: async () => undefined }
    if (requestName === '@/lib/topic-activity-config') return {
      normalizeTopicActivityConfig: (input: Record<string, unknown>, _type: string, existing: Record<string, unknown>) => ({
        valid: true,
        value: {
          ...existing,
          pinToPlaza: typeof input.pinToPlaza === 'boolean' ? input.pinToPlaza : existing.pinToPlaza,
          participationRule: typeof input.participationRule === 'string' ? input.participationRule : existing.participationRule,
          participationMode: typeof input.participationMode === 'string' ? input.participationMode : existing.participationMode,
          allowImageAttachments: typeof input.allowImageAttachments === 'boolean' ? input.allowImageAttachments : existing.allowImageAttachments,
          formSchema: Object.prototype.hasOwnProperty.call(input, 'formSchema') ? input.formSchema : existing.formSchema,
          rewardGrantMode: typeof input.rewardGrantMode === 'string' ? input.rewardGrantMode : existing.rewardGrantMode,
          rewardGrantAt: existing.rewardGrantAt,
          rewardPoints: typeof input.rewardPoints === 'number' ? input.rewardPoints : existing.rewardPoints,
          rewardBadgeIds: Array.isArray(input.rewardBadgeIds) ? input.rewardBadgeIds : existing.rewardBadgeIds,
        },
      }),
    }
    if (requestName === '@/lib/topic-activity') return { syncActivityPostInTransaction: async () => undefined }
    if (requestName === '@/lib/topic-activity-v2-lottery') return {
      assertTopicLotteryActivityWindow: async () => {
        events.push('topic-window')
        if (topicWindowError) throw topicWindowError
      },
    }
    if (requestName === '@/lib/prisma') {
      const tx = {
        $queryRaw: async () => { events.push('lock'); return [] },
        activity: {
          findUnique: async () => ({ status: transactionActivity.status, type: transactionActivity.type }),
          findUniqueOrThrow: async () => cloneActivity(transactionActivity),
          update: async ({ data, ...rest }: { data: Record<string, unknown>; [key: string]: unknown }) => {
            events.push('update')
            updateCalls.push({ data, ...rest })
            transactionActivity = { ...transactionActivity, ...data } as Activity
            current = cloneActivity(transactionActivity)
            return cloneActivity(transactionActivity)
          },
        },
        lottery: {
          findFirst: async (args: Record<string, unknown>) => {
            events.push('legacy-lottery-check')
            legacyLotteryQueries.push(args)
            if (legacyLottery) throw new MockActivityConfigurationError('活动结束时间必须晚于已有抽奖开奖时间，请先调整抽奖时间。')
            return null
          },
        },
        topicActivityParticipation: { count: async () => 0 },
        badge: { count: async () => 0 },
      }
      return {
        prisma: {
          activity: { findUnique: async () => cloneActivity(current) },
          activityReward: { findUnique: async () => null },
          topicActivityParticipation: { count: async () => 0 },
          $transaction: async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
        },
      }
    }
    return originalLoad.call(this, requestName, parent, main)
  }
  try {
    route = await import('../app/api/admin/activities/[activityId]/route')
  } finally {
    loader._load = originalLoad
  }
})

beforeEach(() => {
  authenticated = true
  legacyLottery = null
  topicWindowError = null
  current = makeActivity()
  transactionActivity = cloneActivity(current)
  updateCalls = []
  legacyLotteryQueries = []
  events = []
})

test('publishing a wizard-owned TOPIC_ACTIVITY with valid V2 lottery leaves the legacy lottery query scoped', async () => {
  const response = await route.PATCH(request({ status: 'PUBLISHED' }), context)
  assert.equal(response.status, 200)
  assert.equal(updateCalls.length, 1)
  assert.equal((updateCalls[0].data as Record<string, unknown>).status, 'PUBLISHED')
  assert.deepEqual(legacyLotteryQueries[0]?.where && (legacyLotteryQueries[0].where as Record<string, unknown>).TopicLottery, { is: null })
  assert.deepEqual(events.slice(0, 3), ['lock', 'topic-window', 'legacy-lottery-check'])
})

test('a conflicting legacy scheduled lottery blocks publish before the activity update', async () => {
  legacyLottery = { id: 'legacy-lottery', drawAt: new Date('2026-11-01T00:00:00.000Z') }
  const response = await route.PATCH(request({ status: 'PUBLISHED' }), context)
  assert.equal(response.status, 400)
  assert.equal(updateCalls.length, 0)
})

test('cancelled activities remain terminal and cannot be published again', async () => {
  current = makeActivity({ status: 'CANCELLED' })
  transactionActivity = cloneActivity(current)
  const response = await route.PATCH(request({ status: 'PUBLISHED' }), context)
  assert.equal(response.status, 409)
  assert.equal(updateCalls.length, 0)
  assert.deepEqual(events, [])
})

test('V2 lottery window errors propagate as controlled rule-lock responses', async () => {
  topicWindowError = new TopicLotteryError('LOTTERY_ACTIVITY_WINDOW_LOCKED', '已有抽奖参与或名单已冻结，不能修改活动资格时间', 409)
  const response = await route.PATCH(request({ status: 'PUBLISHED' }), context)
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { code: 'LOTTERY_ACTIVITY_WINDOW_LOCKED', message: '已有抽奖参与或名单已冻结，不能修改活动资格时间' })
  assert.equal(updateCalls.length, 0)
})

test('anonymous and hostile-origin publish attempts do not read or write activity state', async () => {
  authenticated = false
  let response = await route.PATCH(request({ status: 'PUBLISHED' }), context)
  assert.equal(response.status, 401)
  assert.equal(updateCalls.length, 0)

  authenticated = true
  response = await route.PATCH(request({ status: 'PUBLISHED' }, { origin: 'https://hostile.invalid' }), context)
  assert.equal(response.status, 403)
  assert.equal(updateCalls.length, 0)
})

test('metadata-only publish retains the existing activity fields', async () => {
  const response = await route.PATCH(request({ status: 'PUBLISHED' }), context)
  assert.equal(response.status, 200)
  const data = updateCalls[0].data as Record<string, unknown>
  assert.equal(data.title, '天使的礼物')
  assert.equal(data.description, '分享活动')
  assert.equal(data.type, 'TOPIC_ACTIVITY')
  assert.equal(data.participationRule, '发布活动相关内容并上传截图')
  assert.equal(data.allowImageAttachments, true)
})
