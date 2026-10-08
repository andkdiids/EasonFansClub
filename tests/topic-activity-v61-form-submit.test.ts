import assert from 'node:assert/strict'
import Module from 'node:module'
import test, { before, beforeEach } from 'node:test'

const schema = { version: 1, fields: [{ id: 'name', label: '姓名', type: 'TEXT', required: true }] }
type StoredForm = { id: string; activityId: string; userId: string; status: string }
let forms: StoredForm[] = []
let status = 'PUBLISHED'
let endsAt: Date | null = null
let startsAt: Date | null = null
let mode = 'BOTH'
let commits = 0
let lockTail = Promise.resolve()
let route: typeof import('../app/api/activities/[activityId]/form-submissions/route')

// Exercise the real handler with an explicit per-Activity row-lock fixture.
// This proves lock/check/create ordering; it is not a real MySQL smoke test.
const prisma = {
  $transaction: async (work: (tx: unknown) => Promise<unknown>, options: { isolationLevel: string }) => {
    assert.equal(options.isolationLevel, 'Serializable')
    let release: (() => void) | undefined
    let locked = false
    const tx = {
      $queryRaw: async (query: TemplateStringsArray, activityId: string) => {
        assert.match(query.join(''), /SELECT `id` FROM `Activity`.*FOR UPDATE/)
        assert.equal(activityId, 'activity-1')
        const previous = lockTail
        lockTail = new Promise<void>((resolve) => { release = resolve })
        await previous
        locked = true
        return [{ id: activityId }]
      },
      activity: { findUnique: async () => {
        assert.equal(locked, true)
        return { id: 'activity-1', type: 'TOPIC_ACTIVITY', status, startsAt, endsAt, participationMode: mode, allowImageAttachments: true, formSchema: schema }
      } },
      topicActivityFormSubmission: {
        findFirst: async ({ where }: { where: { activityId: string; userId: string } }) => {
          assert.equal(locked, true)
          return forms.find((form) => form.activityId === where.activityId && form.userId === where.userId) || null
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          assert.equal(locked, true)
          await new Promise((resolve) => setTimeout(resolve, 5))
          const form = { id: `form-${forms.length + 1}`, activityId: String(data.activityId), userId: String(data.userId), status: 'PENDING' }
          forms.push(form); commits += 1
          return { ...form, submittedAt: new Date() }
        },
      },
      topicActivityImageAsset: { findMany: async () => [] },
    }
    try { return await work(tx) } finally { release?.() }
  },
}

before(async () => {
  const original = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
  ;(Module as unknown as { _load: typeof original })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma }
    if (request === '@/lib/security') return {
      requireRequestUser: async (req: Request) => {
        const bearer = req.headers.get('authorization')
        const cookie = req.headers.get('cookie')
        const id = bearer === 'Bearer fixture-valid' || cookie === 'session=fixture-valid' ? 'user-1' : bearer === 'Bearer fixture-other' ? 'user-2' : null
        return { user: id ? { id } : null, response: new Response(null, { status: 401 }) }
      },
      enforceApiRateLimit: async () => null,
    }
    return original.call(this, request, parent, isMain)
  }
  try { route = await import('../app/api/activities/[activityId]/form-submissions/route') }
  finally { (Module as unknown as { _load: typeof original })._load = original }
})

beforeEach(() => { forms = []; status = 'PUBLISHED'; endsAt = null; startsAt = null; mode = 'BOTH'; commits = 0; lockTail = Promise.resolve() })

function submit(headers: HeadersInit = { authorization: 'Bearer fixture-valid' }, body: unknown = { answers: { name: '资料' }, userId: 'spoofed-user' }) {
  return route.POST(new Request('https://fixture.test/api/activities/activity-1/form-submissions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ activityId: 'activity-1' }) })
}

test('Cookie and no-Cookie Bearer first submissions succeed with authoritative identity', async () => {
  assert.equal((await submit({ cookie: 'session=fixture-valid' })).status, 201)
  assert.equal(forms[0].userId, 'user-1')
  assert.equal((await submit({ authorization: 'Bearer fixture-other' })).status, 201)
  assert.equal(forms[1].userId, 'user-2')
})

test('same user retry is 409, including historical non-reviewable status values; no records deleted', async () => {
  forms = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'].map((status, index) => ({ id: `legacy-${index}`, activityId: 'activity-1', userId: 'user-1', status }))
  const before = structuredClone(forms)
  const response = await submit()
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'FORM_ALREADY_SUBMITTED')
  assert.deepEqual(forms, before)
  assert.equal(commits, 0)
})

test('ten concurrent real handler calls create exactly one form under the shared row lock', async () => {
  const responses = await Promise.all(Array.from({ length: 10 }, () => submit()))
  assert.equal(responses.filter((response) => response.status === 201).length, 1)
  assert.equal(responses.filter((response) => response.status === 409).length, 9)
  assert.equal(forms.length, 1)
  assert.equal(commits, 1)
})

test('anonymous, invalid, and expired Bearer are rejected before any write', async () => {
  const denied: Record<string, string>[] = [{}, { authorization: 'Bearer fixture-invalid' }, { authorization: 'Bearer fixture-expired' }]
  for (const headers of denied) assert.equal((await submit(headers)).status, 401)
  assert.equal(commits, 0)
})

test('end, cancellation and not-started guards remain server-enforced', async () => {
  endsAt = new Date(Date.now() - 1000)
  assert.equal((await (await submit()).json()).code, 'ACTIVITY_ENDED')
  endsAt = null; status = 'CANCELLED'
  assert.equal((await (await submit()).json()).code, 'ACTIVITY_CANCELLED')
  status = 'PUBLISHED'; startsAt = new Date(Date.now() + 60_000)
  assert.equal((await (await submit()).json()).code, 'CLOSED')
  assert.equal(commits, 0)
})

test('invalid or another user asset cannot create a partial submission', async () => {
  const response = await submit(undefined, { answers: { name: '资料' }, attachmentAssetIds: ['foreign-asset'] })
  assert.equal(response.status, 403)
  assert.equal(forms.length, 0)
})
