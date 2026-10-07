import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import Module from 'node:module'
import { before, beforeEach, test } from 'node:test'
import { SignJWT } from 'jose'

// Ephemeral test credentials, real request guards/JWT verification, and an
// in-memory persistence fixture. No external service or database is contacted.
process.env.MOBILE_ACCESS_TOKEN_SECRET = randomBytes(48).toString('hex')

type Field = 'startedAt' | 'teachingCompletedAt' | 'questionsCompletedAt' | 'completedAt'
type Row = { userId: string; lessonId: string } & Record<Field, Date | null>
type Action = 'START' | 'TEACHING_COMPLETE' | 'QUESTIONS_COMPLETE' | 'COMPLETE'
const fields: Field[] = ['startedAt', 'teachingCompletedAt', 'questionsCompletedAt', 'completedAt']
const actions: Action[] = ['START', 'TEACHING_COMPLETE', 'QUESTIONS_COMPLETE', 'COMPLETE']
const rows = new Map<string, Row>()
const revokedUsers = new Set<string>()
let webCookieUserId: string | null = null
let transactionCalls = 0
let writes = 0
let upsertConflicts = 0
let injectedErrors: Error[] = []
let lessonOneApproved = true
let readFailure = false

function dbError(code: string, target?: string) {
  return Object.assign(new Error('fixture database error'), {
    code, meta: { modelName: 'CantoneseLessonProgress', ...(target ? { target } : {}) },
  })
}

function key(userId: string, lessonId: string) { return `${userId}:${lessonId}` }
function emptyRow(userId: string, lessonId: string): Row {
  return { userId, lessonId, startedAt: null, teachingCompletedAt: null, questionsCompletedAt: null, completedAt: null }
}
function cloneRow(row: Row) {
  return { ...row, ...Object.fromEntries(fields.map((field) => [field, row[field] ? new Date(row[field]) : null])) }
}
function sessionUser(id: string) {
  return { id, uid: 42, username: id, nickname: id, role: 'USER' as const }
}

const definitions = [
  { lessonId: 'lesson-01', lessonNumber: 1, prerequisiteLessonId: null },
  { lessonId: 'lesson-02', lessonNumber: 2, prerequisiteLessonId: 'lesson-01' },
  { lessonId: 'lesson-05', lessonNumber: 5, prerequisiteLessonId: 'lesson-02' },
  { lessonId: 'lesson-77', lessonNumber: 77, prerequisiteLessonId: 'lesson-01' },
  { lessonId: 'lesson-88', lessonNumber: 88, prerequisiteLessonId: null },
]
function teachingRows() {
  return definitions.map(({ lessonId }) => ({
    externalId: `${lessonId}.teaching`, lessonId,
    status: lessonId === 'lesson-05' || (lessonId === 'lesson-01' && !lessonOneApproved) ? 'CONTENT_REVIEW_REQUIRED' : 'APPROVED',
    requiresAudio: lessonId === 'lesson-05', requiresSpeaking: lessonId === 'lesson-05',
    displayText: 'fixture content', audioId: lessonId === 'lesson-05' ? 'unready-audio' : null,
  }))
}
const dbFixture = {
  mobileAuthSession: {
    findFirst: async ({ where }: { where: { userId: string; id: string; revokedAt: null; expiresAt: { gt: Date } } }) => {
      assert.equal(where.revokedAt, null)
      assert.ok(where.expiresAt.gt instanceof Date)
      return revokedUsers.has(where.userId) || where.id !== `session-${where.userId}` ? null : { userId: where.userId }
    },
  },
  user: {
    findFirst: async ({ where }: { where: { id: string } }) => ({
      id: where.id, uid: 42, nickname: where.id, nicknameModerationStatus: 'APPROVED',
      nicknameViolationDisplay: null, avatarUrl: null, Profile: null,
    }),
  },
  cantoneseCourseDefinition: { findMany: async () => {
    if (readFailure) throw new Error('private fixture error must not leak')
    return definitions
  } },
  cantoneseLessonContent: { findMany: async (input: { where?: { status: string } }) =>
    teachingRows().filter((item) => !input.where?.status || item.status === input.where.status),
  },
  cantoneseQuestion: { findMany: async () => [
    { externalId: 'lesson-01.question', lessonId: 'lesson-01', status: 'APPROVED', questionType: 'SINGLE_SELECT', prerequisiteContentIds: ['lesson-01.teaching'], audioId: null, speakingReferenceId: null },
    { externalId: 'lesson-02.pending-question', lessonId: 'lesson-02', status: 'CONTENT_REVIEW_REQUIRED', questionType: 'LISTENING', prerequisiteContentIds: ['lesson-02.teaching'], audioId: 'unready-audio', speakingReferenceId: null },
  ] },
  cantoneseAudioAsset: { findMany: async () => [] },
  cantoneseLessonProgress: {
    findMany: async ({ where }: { where: { userId: string } }) => [...rows.values()]
      .filter((row) => row.userId === where.userId).map(cloneRow),
    upsert: async (input: { where: { userId_lessonId: { userId: string; lessonId: string } }; create: { userId: string; lessonId: string }; update: Record<string, never> }) => {
      const { userId, lessonId } = input.where.userId_lessonId
      assert.deepEqual(input.create, { userId, lessonId })
      assert.deepEqual(input.update, {})
      const rowKey = key(userId, lessonId)
      const absentAtRead = !rows.has(rowKey)
      // Model a MySQL non-native upsert race: both requests can initially read
      // no row, but the database unique key admits only one insert.
      await new Promise<void>((resolve) => setImmediate(resolve))
      if (absentAtRead && rows.has(rowKey)) {
        upsertConflicts += 1
        throw dbError('P2002', 'CantoneseLessonProgress_userId_lessonId_key')
      }
      if (!rows.has(rowKey)) { rows.set(rowKey, emptyRow(userId, lessonId)); writes += 1 }
      return cloneRow(rows.get(rowKey)!)
    },
    updateMany: async ({ where, data }: { where: { userId: string; lessonId: string } & Partial<Record<Field, null>>; data: Partial<Record<Field, Date>> }) => {
      const row = rows.get(key(where.userId, where.lessonId))
      const field = Object.keys(data)[0] as Field
      assert.equal(where[field], null)
      if (!row || row[field] !== null) return { count: 0 }
      row[field] = data[field]!
      writes += 1
      return { count: 1 }
    },
  },
}
const prismaFixture = {
  ...dbFixture,
  $transaction: async <T>(operation: (tx: typeof dbFixture) => Promise<T>): Promise<T> => {
    transactionCalls += 1
    const injected = injectedErrors.shift()
    if (injected) throw injected
    return operation(dbFixture)
  },
}

const originalLoad = (Module as unknown as { _load: (request: string, parent?: unknown, isMain?: boolean) => unknown })._load
let getRoute: typeof import('../app/api/learning/cantonese/progress/route')
let postRoute: typeof import('../app/api/learning/cantonese/progress/[lessonId]/route')
before(async () => {
  (Module as unknown as { _load: typeof originalLoad })._load = function (request, parent, isMain) {
    if (request === '@/lib/prisma') return { prisma: prismaFixture }
    if (request === '@/lib/auth') return {
      getCurrentUser: async () => webCookieUserId ? sessionUser(webCookieUserId) : null,
      getCurrentUserById: async (id: string) => sessionUser(id),
      isAuthServiceUnavailableError: () => false,
    }
    if (request === '@/lib/admin-permissions') return { hasAdminPermission: async () => false }
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    getRoute = await import('../app/api/learning/cantonese/progress/route')
    postRoute = await import('../app/api/learning/cantonese/progress/[lessonId]/route')
  } finally {
    (Module as unknown as { _load: typeof originalLoad })._load = originalLoad
  }
})
beforeEach(() => {
  rows.clear(); revokedUsers.clear(); webCookieUserId = null
  transactionCalls = 0; writes = 0; upsertConflicts = 0; injectedErrors = []
  lessonOneApproved = true; readFailure = false
})

async function bearer(userId: string, lifetime = 300) {
  const now = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({ sid: `session-${userId}`, typ: 'mobile_access' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('ecfc').setAudience('ecfc-mobile')
    .setSubject(userId).setIssuedAt(now).setExpirationTime(now + lifetime)
    .sign(new TextEncoder().encode(process.env.MOBILE_ACCESS_TOKEN_SECRET))
  return { authorization: `Bearer ${token}` }
}
function request(method: 'GET' | 'POST', headers: HeadersInit = {}, body?: unknown, query = '') {
  return new Request(`https://ecfc.fans/api/learning/cantonese/progress${query}`, {
    method, headers: { ...Object.fromEntries(new Headers(headers)), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function post(lessonId: string, action: Action, headers: HeadersInit, extra = {}) {
  return postRoute.POST(request('POST', headers, { action, ...extra }), { params: Promise.resolve({ lessonId }) })
}
async function responseLesson(response: Response, lessonId: string) {
  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control')!, /private, no-store/)
  const body = await response.json()
  assert.equal(body.source, 'SERVER')
  return body.lessons.find((item: { lessonId: string }) => item.lessonId === lessonId)
}
async function finish(lessonId: string, headers: HeadersInit) {
  for (const action of actions) assert.equal((await post(lessonId, action, headers)).status, 200)
}

test('actual GET/POST reject anonymous, invalid, expired and revoked Bearer without writes or cookie fallback', async () => {
  assert.equal((await getRoute.GET(request('GET'))).status, 401)
  assert.equal((await post('lesson-01', 'START', {})).status, 401)
  webCookieUserId = 'cookie-user'
  assert.equal((await getRoute.GET(request('GET', { authorization: 'Bearer invalid-fixture' }))).status, 401)
  assert.equal((await post('lesson-01', 'START', await bearer('expired-user', -60))).status, 401)
  revokedUsers.add('revoked-user')
  assert.equal((await getRoute.GET(request('GET', await bearer('revoked-user')))).status, 401)
  assert.equal(transactionCalls, 0)
  assert.equal(writes, 0)
})

test('actual Mobile Bearer GET uses explicit prerequisites and own user; L05 pending stays NOT_RELEASED', async () => {
  rows.set(key('other-user', 'lesson-01'), { ...emptyRow('other-user', 'lesson-01'), completedAt: new Date() })
  const response = await getRoute.GET(request('GET', await bearer('user-a'), undefined, '?userId=other-user'))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.code, 'OK')
  assert.equal(body.source, 'SERVER')
  assert.deepEqual(body.lessons.map((item: { state: string }) => item.state), ['AVAILABLE', 'LOCKED', 'NOT_RELEASED', 'LOCKED', 'AVAILABLE'])
  assert.ok(body.lessons.every((item: { completedAt: unknown }) => item.completedAt === null))
})

test('actual Mobile Bearer POST START ignores forged body userId and never changes another user', async () => {
  const response = await post('lesson-01', 'START', await bearer('user-a'), { userId: 'user-b', completed: true, score: 100 })
  const lesson = await responseLesson(response, 'lesson-01')
  assert.equal(lesson.state, 'AVAILABLE')
  assert.ok(lesson.startedAt)
  assert.equal(lesson.completedAt, null)
  assert.equal(rows.has(key('user-b', 'lesson-01')), false)
  assert.equal(rows.size, 1)
})

test('Web Cookie request guard fixture supports progress GET and POST without Bearer', async () => {
  webCookieUserId = 'web-user'
  const headers = { cookie: 'eason_session=test-fixture-session' }
  assert.equal((await getRoute.GET(request('GET', headers))).status, 200)
  assert.equal((await post('lesson-01', 'START', headers)).status, 200)
  assert.equal(rows.has(key('web-user', 'lesson-01')), true)
})

test('all four route actions and duplicates are idempotent with stable first timestamps', async () => {
  const headers = await bearer('user-a')
  for (const action of actions) {
    assert.equal((await post('lesson-01', action, headers)).status, 200)
    const first = cloneRow(rows.get(key('user-a', 'lesson-01'))!)
    const writesBefore = writes
    assert.equal((await post('lesson-01', action, headers)).status, 200)
    assert.deepEqual(rows.get(key('user-a', 'lesson-01')), first)
    assert.equal(writes, writesBefore)
  }
  assert.equal(rows.size, 1)
  assert.ok(fields.every((field) => rows.get(key('user-a', 'lesson-01'))![field] instanceof Date))
})

test('COMPLETE validates start, teaching and released questions; no client completed/score shortcut', async () => {
  const headers = await bearer('user-a')
  assert.deepEqual(await (await post('lesson-01', 'COMPLETE', headers, { completed: true })).json(), { ok: false, code: 'LESSON_NOT_STARTED' })
  await post('lesson-01', 'START', headers)
  assert.deepEqual(await (await post('lesson-01', 'QUESTIONS_COMPLETE', headers)).json(), { ok: false, code: 'TEACHING_NOT_COMPLETE' })
  await post('lesson-01', 'TEACHING_COMPLETE', headers)
  assert.deepEqual(await (await post('lesson-01', 'COMPLETE', headers, { score: 100 })).json(), { ok: false, code: 'LEARNING_PARTS_INCOMPLETE' })
  await post('lesson-01', 'QUESTIONS_COMPLETE', headers, { score: 0 })
  assert.equal((await responseLesson(await post('lesson-01', 'COMPLETE', headers), 'lesson-01')).state, 'COMPLETED')
})

test('pending listening candidates are not required milestones for an otherwise released lesson', async () => {
  const headers = await bearer('user-a')
  await finish('lesson-01', headers)
  await post('lesson-02', 'START', headers)
  await post('lesson-02', 'TEACHING_COMPLETE', headers)
  const lesson = await responseLesson(await post('lesson-02', 'COMPLETE', headers), 'lesson-02')
  assert.equal(lesson.state, 'COMPLETED')
  assert.equal(lesson.questionsCompletedAt, null)
})

test('all actions reject unreleased L05 and locked lessons before any persistence', async () => {
  const headers = await bearer('user-a')
  for (const action of actions) {
    const unreleased = await post('lesson-05', action, headers)
    assert.equal(unreleased.status, 404)
    assert.equal((await unreleased.json()).code, 'LESSON_NOT_RELEASED')
    const locked = await post('lesson-02', action, headers)
    assert.equal(locked.status, 409)
    assert.equal((await locked.json()).code, 'LESSON_LOCKED')
  }
  assert.equal(rows.size, 0)
  assert.equal(writes, 0)
})

test('invalid lesson, missing action and completed=true cannot bypass the action contract', async () => {
  const headers = await bearer('user-a')
  assert.equal((await post('other', 'START', headers)).status, 404)
  const invalid = await postRoute.POST(request('POST', headers, { completed: true }), { params: Promise.resolve({ lessonId: 'lesson-01' }) })
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).code, 'INVALID_ACTION')
  assert.equal(writes, 0)
})

test('client A completion is authoritative on client B fresh GET and unlocks only its own prerequisite', async () => {
  await finish('lesson-01', await bearer('user-a'))
  const clientB = await getRoute.GET(request('GET', await bearer('user-a')))
  const snapshot = await clientB.json()
  assert.equal(snapshot.lessons.find((item: { lessonId: string }) => item.lessonId === 'lesson-01').state, 'COMPLETED')
  assert.equal(snapshot.lessons.find((item: { lessonId: string }) => item.lessonId === 'lesson-02').state, 'AVAILABLE')
  assert.equal(snapshot.lessons.find((item: { lessonId: string }) => item.lessonId === 'lesson-77').state, 'AVAILABLE')
  const otherUser = await responseLesson(await getRoute.GET(request('GET', await bearer('user-b'))), 'lesson-02')
  assert.equal(otherUser.state, 'LOCKED')
})

test('concurrent START retries the unique-key upsert race: two successes, one row, one first timestamp', async () => {
  const headers = await bearer('user-a')
  const responses = await Promise.all([post('lesson-01', 'START', headers), post('lesson-01', 'START', headers)])
  assert.deepEqual(responses.map((response) => response.status), [200, 200])
  assert.equal(upsertConflicts, 1)
  assert.equal(rows.size, 1)
  const lessons = await Promise.all(responses.map((response) => responseLesson(response, 'lesson-01')))
  assert.equal(lessons[0].startedAt, lessons[1].startedAt)
  assert.equal(rows.get(key('user-a', 'lesson-01'))!.startedAt?.toISOString(), lessons[0].startedAt)
})

test('concurrent COMPLETE preserves one row and first completion timestamp without a 500', async () => {
  const headers = await bearer('user-a')
  for (const action of actions.slice(0, 3)) await post('lesson-01', action, headers)
  const responses = await Promise.all([post('lesson-01', 'COMPLETE', headers), post('lesson-01', 'COMPLETE', headers)])
  assert.deepEqual(responses.map((response) => response.status), [200, 200])
  const lessons = await Promise.all(responses.map((response) => responseLesson(response, 'lesson-01')))
  assert.equal(lessons[0].completedAt, lessons[1].completedAt)
  assert.equal(lessons[0].state, 'COMPLETED')
  assert.equal(rows.size, 1)
})

test('transient transaction conflict retries, but exhausted conflicts return a controlled 503', async () => {
  const headers = await bearer('user-a')
  injectedErrors = [dbError('P2034')]
  assert.equal((await post('lesson-01', 'START', headers)).status, 200)
  assert.equal(transactionCalls, 2)
  rows.clear(); transactionCalls = 0
  injectedErrors = Array.from({ length: 3 }, () => dbError('P2034'))
  const exhausted = await post('lesson-01', 'START', headers)
  assert.equal(exhausted.status, 503)
  assert.deepEqual(await exhausted.json(), { ok: false, code: 'PROGRESS_UNAVAILABLE' })
  assert.equal(transactionCalls, 3)
  assert.equal(rows.size, 0)
})

test('unrelated unique constraints are not silently retried', async () => {
  injectedErrors = [dbError('P2002', 'unrelated_unique_key')]
  assert.equal((await post('lesson-01', 'START', await bearer('user-a'))).status, 503)
  assert.equal(transactionCalls, 1)
})

test('completion remains monotonic across a later content readiness change and duplicate synchronization', async () => {
  const headers = await bearer('user-a')
  await finish('lesson-01', headers)
  const first = cloneRow(rows.get(key('user-a', 'lesson-01'))!)
  lessonOneApproved = false
  assert.equal((await responseLesson(await getRoute.GET(request('GET', headers)), 'lesson-01')).state, 'COMPLETED')
  for (const action of actions) assert.equal((await post('lesson-01', action, headers)).status, 200)
  assert.deepEqual(rows.get(key('user-a', 'lesson-01')), first)
})

test('read failure is a no-store controlled error and never leaks internal payloads', async () => {
  readFailure = true
  const response = await getRoute.GET(request('GET', await bearer('user-a')))
  assert.equal(response.status, 503)
  assert.match(response.headers.get('cache-control')!, /no-store/)
  assert.deepEqual(await response.json(), { ok: false, code: 'PROGRESS_UNAVAILABLE' })
})
