import assert from 'node:assert/strict'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'

const loader = Module as unknown as { _load: (request: string, parent?: unknown, main?: boolean) => unknown }
const original = loader._load
let route: typeof import('../app/api/activities/me/topic-participations/route')
let queryTexts: string[] = []
let groupByCalls: Array<{ model: string; args: { where?: { userId?: string } } }> = []
let authenticated = true
let participationRows: unknown[] = [{ activityId: 'fixed-only', approvedSubmissionCount: 0, rewardStatus: 'PENDING', rewardEligibleAt: null, rewardGrantedAt: null }]
let activityFindArgs: { where?: Record<string, unknown> } | null = null

const activities = ['poll-only', 'test-only', 'fixed-only', 'task-pending'].map((id) => ({ id, title: id, status: 'PUBLISHED' }))

before(async () => {
  loader._load = function (request, parent, main) {
    if (request === '@/lib/security') return {
      requireRequestUser: async () => authenticated
        ? { user: { id: 'owner' } }
        : { user: null, response: new Response('{}', { status: 401 }) },
    }
    if (request === '@/lib/activity-data') return {
      activitySelect: {},
      serializeActivityRow: (row: typeof activities[number]) => row,
    }
    if (request === '@/lib/topic-activity') return { resolveTopicSubmissionStatus: (input: { pending: number; approved: number; rejected: number }) => input.approved ? 'APPROVED' : input.pending ? 'PENDING' : input.rejected ? 'REJECTED' : 'NOT_PARTICIPATED' }
    if (request === '@/lib/prisma') return {
      prisma: {
        $queryRaw: async (strings: TemplateStringsArray) => {
          const text = strings.join('?')
          queryTexts.push(text)
          return text.includes('COUNT(*)') ? [{ total: 4 }] : activities.map((activityId) => ({ activityId: activityId.id }))
        },
        activity: { findMany: async (args: { where?: Record<string, unknown> }) => { activityFindArgs = args; return activities } },
        topicActivitySubmission: {
          groupBy: async (args: { where?: { userId?: string } }) => {
            groupByCalls.push({ model: 'submission', args })
            return [{ activityId: 'task-pending', status: 'PENDING', _count: { _all: 1 } }]
          },
        },
        topicActivityFormSubmission: {
          groupBy: async (args: { where?: { userId?: string } }) => {
            groupByCalls.push({ model: 'form', args })
            return []
          },
        },
        topicActivityParticipation: {
          findMany: async (args: { where?: { userId?: string } }) => {
            groupByCalls.push({ model: 'participation', args })
            return participationRows
          },
        },
        topicActivityPollVote: {
          groupBy: async (args: { where?: { userId?: string } }) => {
            groupByCalls.push({ model: 'poll', args })
            return [{ activityId: 'poll-only', _count: { _all: 1 } }]
          },
        },
        topicActivityTestAttempt: {
          groupBy: async (args: { where?: { userId?: string } }) => {
            groupByCalls.push({ model: 'test', args })
            return [{ activityId: 'test-only', _count: { _all: 2 } }]
          },
        },
        topicActivityRewardGrant: {
          groupBy: async (args: { where?: { userId?: string } }) => {
            groupByCalls.push({ model: 'grant', args })
            return [
              { activityId: 'fixed-only', status: 'PENDING', _count: { _all: 1 } },
              { activityId: 'task-pending', status: 'GRANTED', _count: { _all: 1 } },
            ]
          },
        },
      },
    }
    return original.call(this, request, parent, main)
  }
  try { route = await import('../app/api/activities/me/topic-participations/route') } finally { loader._load = original }
})

beforeEach(() => { queryTexts = []; groupByCalls = []; authenticated = true; participationRows = [{ activityId: 'fixed-only', approvedSubmissionCount: 0, rewardStatus: 'PENDING', rewardEligibleAt: null, rewardGrantedAt: null }]; activityFindArgs = null })

test('my participations includes owner-scoped V2 poll, test, fixed reward and pending task activity', async () => {
  const response = await route.GET(new Request('http://localhost/api/activities/me/topic-participations?page=1&pageSize=20'))
  assert.equal(response.status, 200)
  const body = await response.json() as { total: number; participations: Array<Record<string, unknown>> }
  assert.equal(body.total, 4)
  assert.equal(body.participations.length, 4)
  assert.equal(body.participations.find((item) => (item.activity as { id: string }).id === 'poll-only')?.pollVoteCount, 1)
  assert.equal(body.participations.find((item) => (item.activity as { id: string }).id === 'test-only')?.testAttemptCount, 2)
  const fixed = body.participations.find((item) => (item.activity as { id: string }).id === 'fixed-only')!
  assert.equal(fixed.rewardStatus, 'PENDING')
  assert.equal(fixed.pendingRewardGrantCount, 1)
  const task = body.participations.find((item) => (item.activity as { id: string }).id === 'task-pending')!
  assert.equal(task.submissionCount, 1)
  assert.equal(task.pendingSubmissionCount, 1)
  assert.deepEqual(activityFindArgs?.where?.status, { in: ['PUBLISHED', 'CANCELLED'] })
  assert.match(queryTexts.join('\n'), /TopicActivityParticipation/u)
  assert.match(queryTexts.join('\n'), /TopicActivityPollVote/u)
  assert.match(queryTexts.join('\n'), /TopicActivityTestAttempt/u)
  assert.match(queryTexts.join('\n'), /TopicActivityRewardGrant/u)
  assert.match(queryTexts.join('\n'), /combined\.\x60activityId\x60 ASC/u)
  assert.ok(groupByCalls.length >= 6)
  for (const call of groupByCalls) assert.equal(call.args.where?.userId, 'owner', call.model)
})

test('reward summary falls back to persisted grant status when participation row is absent', async () => {
  authenticated = true
  participationRows = []
  const response = await route.GET(new Request('http://localhost/api/activities/me/topic-participations'))
  const body = await response.json() as { participations: Array<Record<string, unknown>> }
  const fixed = body.participations.find((item) => (item.activity as { id: string }).id === 'fixed-only')!
  assert.equal(fixed.rewardStatus, 'PENDING')
  assert.equal(fixed.pendingRewardGrantCount, 1)
})

test('my participations remains authentication-gated', async () => {
  authenticated = false
  assert.equal((await route.GET(new Request('http://localhost/api/activities/me/topic-participations'))).status, 401)
})
