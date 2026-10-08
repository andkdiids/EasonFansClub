import assert from 'node:assert/strict'
import Module from 'node:module'
import test, { before } from 'node:test'
import { decodeTopicActivityFormCursor, encodeTopicActivityFormCursor } from '@/lib/topic-activity-form-cursor'

type Row = { id: string; activityId: string; userId: string; submittedAt: Date; replies: unknown[] }
type Where = { activityId?: string; userId?: string; Replies?: { some?: unknown; none?: unknown }; OR?: Array<{ submittedAt: Date | { lt: Date }; id?: { lt: string } }> }
let rows: Row[] = []
let calls = 0
let route: typeof import('../app/api/admin/activities/[activityId]/form-submissions/route')
function matching(where: Where) {
  return rows.filter((row) => (!where.activityId || row.activityId === where.activityId)
    && (!where.userId || row.userId === where.userId)
    && (!where.Replies || (where.Replies.some ? row.replies.length > 0 : row.replies.length === 0))
    && (!where.OR || where.OR.some((clause) => clause.submittedAt instanceof Date
      ? row.submittedAt.getTime() === clause.submittedAt.getTime() && row.id < (clause.id?.lt || '')
      : row.submittedAt < clause.submittedAt.lt)))
}
before(async () => {
  const original = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
  ;(Module as unknown as { _load: typeof original })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: {
      activity: { findFirst: async () => { calls += 1; return { id: 'activity-1' } } },
      topicActivityFormSubmission: {
        count: async ({ where }: { where: Where }) => matching(where).length,
        findMany: async ({ where, skip = 0, take, orderBy }: { where: Where; skip?: number; take: number; orderBy: unknown }) => {
          assert.deepEqual(orderBy, [{ submittedAt: 'desc' }, { id: 'desc' }])
          return matching(where).sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime() || b.id.localeCompare(a.id)).slice(skip, skip + take)
        },
      },
      topicActivitySubmission: { count: async () => 0, groupBy: async () => [] },
    } }
    if (request === '@/lib/security') return { requireRequestAdmin: async (req: Request, permission: string) => {
      assert.equal(permission, 'activity_manage')
      const valid = req.headers.get('authorization') === 'Bearer fixture-admin' || req.headers.get('cookie') === 'session=fixture-admin'
      return { user: valid ? { id: 'admin-1' } : null, response: new Response(null, { status: req.headers.has('authorization') ? 403 : 401 }) }
    } }
    if (request === '@/lib/topic-activity-form-view') return { serializeTopicActivityFormSubmission: async (row: Row) => ({ ...row, status: row.replies.length ? 'REPLIED' : 'SUBMITTED' }) }
    return original.call(this, request, parent, isMain)
  }
  try { route = await import('../app/api/admin/activities/[activityId]/form-submissions/route') }
  finally { (Module as unknown as { _load: typeof original })._load = original }
})
function request(query = '', headers: Record<string, string> = { authorization: 'Bearer fixture-admin' }) {
  return route.GET(new Request('https://fixture.test/api/admin/activities/activity-1/form-submissions?' + query, { headers }), { params: Promise.resolve({ activityId: 'activity-1' }) })
}
function reset() {
  rows = Array.from({ length: 6 }, (_, index) => ({ id: 'form-' + (6 - index), activityId: 'activity-1', userId: index < 4 ? 'user-1' : 'user-2', submittedAt: new Date('2026-10-08T00:00:00.000Z'), replies: [] }))
  calls = 0
}

test('cursor is bounded and rejects malformed IDs/dates without trusting a supplied scope', () => {
  const row = { submittedAt: new Date('2026-10-08T00:00:00.000Z'), id: 'form-6' }
  assert.deepEqual(decodeTopicActivityFormCursor(encodeTopicActivityFormCursor(row)), row)
  for (const value of ['', '?', 'a'.repeat(701), Buffer.from(JSON.stringify({ id: '../../other', submittedAt: row.submittedAt })).toString('base64url'), Buffer.from(JSON.stringify({ id: 'ok', submittedAt: 'invalid' })).toString('base64url')]) assert.equal(decodeTopicActivityFormCursor(value), null)
})

test('actual admin cursor route appends without skipping rows when unreplied membership shrinks', async () => {
  reset()
  let response = await request('replyStatus=UNREPLIED&pageSize=2&userId=user-1')
  assert.equal(response.status, 200)
  let data = await response.json()
  assert.deepEqual(data.submissions.map((row: Row) => row.id), ['form-6', 'form-5'])
  assert.equal(data.hasMore, true)
  rows[0].replies.push({ id: 'reply-1' })
  rows.unshift({ id: 'form-9', activityId: 'other-activity', userId: 'user-1', submittedAt: new Date('2027-01-01'), replies: [] })
  response = await request('replyStatus=UNREPLIED&pageSize=2&page=2&userId=user-1&cursor=' + data.nextCursor)
  data = await response.json()
  assert.deepEqual(data.submissions.map((row: Row) => row.id), ['form-4', 'form-3'])
  assert.equal(data.hasMore, false)
  assert.equal(data.counts.formSubmissions, 4)
  assert.equal(data.counts.unrepliedForms, 3)
  assert.match(response.headers.get('cache-control') || '', /private, no-store/)
})

test('offset clients stay compatible; invalid cursor rejects; Cookie/Bearer admin auth and anonymous denial retained', async () => {
  reset()
  const data = await (await request('page=2&pageSize=2', { cookie: 'session=fixture-admin' })).json()
  assert.deepEqual(data.submissions.map((row: Row) => row.id), ['form-4', 'form-3'])
  assert.equal((await request('cursor=not-json')).status, 400)
  const reads = calls
  assert.equal((await request('', {})).status, 401)
  assert.equal((await request('', { authorization: 'Bearer ordinary-user' })).status, 403)
  assert.equal(calls, reads)
})
