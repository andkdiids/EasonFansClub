import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { NextRequest } from 'next/server'
import {
  buildCantoneseProgressResponse,
  resolveCantoneseLessonState,
  transitionCantoneseProgress,
  type CantoneseLessonProgressRecord,
} from '../lib/cantonese-progress'
import type { CantoneseCourseReadiness } from '../lib/cantonese-course-readiness'

const now = new Date('2026-10-06T03:00:00.000Z')
const root = path.resolve(__dirname, '..')

function readiness(lessonId: string, status: CantoneseCourseReadiness['status'] = 'READY', questionCount = 1): CantoneseCourseReadiness {
  return {
    lessonId,
    status,
    contentCount: 1,
    approvedContentCount: status === 'READY' ? 1 : 0,
    requiredAudioCount: 0,
    readyAudioCount: 0,
    questionCount,
    approvedQuestionCount: questionCount,
    assessmentAvailability: questionCount ? 'READY' : 'REVIEW_PENDING',
  }
}

function record(lessonId: string, overrides: Partial<CantoneseLessonProgressRecord> = {}): CantoneseLessonProgressRecord {
  return {
    lessonId,
    startedAt: null,
    teachingCompletedAt: null,
    questionsCompletedAt: null,
    completedAt: null,
    ...overrides,
  }
}

test('unreleased content is NOT_RELEASED and a published no-prerequisite lesson is AVAILABLE', () => {
  assert.equal(resolveCantoneseLessonState({
    lessonId: 'lesson-05', prerequisiteLessonId: null, readiness: readiness('lesson-05', 'CONTENT_NOT_READY'), progressRows: [],
  }), 'NOT_RELEASED')
  assert.equal(resolveCantoneseLessonState({
    lessonId: 'lesson-01', prerequisiteLessonId: null, readiness: readiness('lesson-01'), progressRows: [],
  }), 'AVAILABLE')
})

test('prerequisite comes only from the explicit course definition and Server completion', () => {
  const lesson = { lessonId: 'lesson-77', prerequisiteLessonId: 'lesson-04', readiness: readiness('lesson-77') }
  assert.equal(resolveCantoneseLessonState({ ...lesson, progressRows: [] }), 'LOCKED')
  assert.equal(resolveCantoneseLessonState({ ...lesson, progressRows: [record('lesson-04', { completedAt: now })] }), 'AVAILABLE')
  // A later lesson with no prerequisite is not locked by its number or array position.
  assert.equal(resolveCantoneseLessonState({
    lessonId: 'lesson-88', prerequisiteLessonId: null, readiness: readiness('lesson-88'), progressRows: [],
  }), 'AVAILABLE')
})

test('COMPLETED remains monotonic even if course content later becomes unavailable', () => {
  assert.equal(resolveCantoneseLessonState({
    lessonId: 'lesson-01',
    prerequisiteLessonId: null,
    readiness: readiness('lesson-01', 'CONTENT_NOT_READY'),
    progressRows: [record('lesson-01', { completedAt: now })],
  }), 'COMPLETED')
})

test('START is idempotent and teaching completion requires an existing start', () => {
  const start = transitionCantoneseProgress({ current: undefined, action: 'START', now, questionsRequired: false, questionsReady: false })
  assert.deepEqual(start, { ok: true, patch: { startedAt: now } })
  assert.deepEqual(transitionCantoneseProgress({
    current: record('lesson-01', { startedAt: now }), action: 'START', now: new Date(now.getTime() + 1000), questionsRequired: false, questionsReady: false,
  }), { ok: true, patch: {} })
  assert.deepEqual(transitionCantoneseProgress({ current: undefined, action: 'TEACHING_COMPLETE', now, questionsRequired: false, questionsReady: false }), {
    ok: false, code: 'LESSON_NOT_STARTED',
  })
})

test('question completion follows teaching and is separate from score', () => {
  const started = record('lesson-01', { startedAt: now })
  assert.deepEqual(transitionCantoneseProgress({ current: started, action: 'QUESTIONS_COMPLETE', now, questionsRequired: true, questionsReady: true }), {
    ok: false, code: 'TEACHING_NOT_COMPLETE',
  })
  const taught = record('lesson-01', { startedAt: now, teachingCompletedAt: now })
  assert.deepEqual(transitionCantoneseProgress({ current: taught, action: 'QUESTIONS_COMPLETE', now, questionsRequired: true, questionsReady: false }), {
    ok: false, code: 'QUESTIONS_NOT_READY',
  })
  assert.deepEqual(transitionCantoneseProgress({ current: taught, action: 'QUESTIONS_COMPLETE', now, questionsRequired: true, questionsReady: true }), {
    ok: true, patch: { questionsCompletedAt: now },
  })
  // Pending/blocked question candidates are not a required client-visible milestone.
  assert.deepEqual(transitionCantoneseProgress({ current: taught, action: 'COMPLETE', now, questionsRequired: false, questionsReady: false }), {
    ok: true, patch: { completedAt: now },
  })
})

test('COMPLETE requires teaching and required questions, but never a score or speaking upload', () => {
  const started = record('lesson-01', { startedAt: now })
  assert.deepEqual(transitionCantoneseProgress({ current: started, action: 'COMPLETE', now, questionsRequired: true, questionsReady: true }), {
    ok: false, code: 'TEACHING_NOT_COMPLETE',
  })
  const taught = record('lesson-01', { startedAt: now, teachingCompletedAt: now })
  assert.deepEqual(transitionCantoneseProgress({ current: taught, action: 'COMPLETE', now, questionsRequired: true, questionsReady: true }), {
    ok: false, code: 'LEARNING_PARTS_INCOMPLETE',
  })
  const ready = record('lesson-01', { startedAt: now, teachingCompletedAt: now, questionsCompletedAt: now })
  assert.deepEqual(transitionCantoneseProgress({ current: ready, action: 'COMPLETE', now, questionsRequired: true, questionsReady: true }), {
    ok: true, patch: { completedAt: now },
  })
  assert.deepEqual(transitionCantoneseProgress({ current: taught, action: 'COMPLETE', now, questionsRequired: false, questionsReady: false }), {
    ok: true, patch: { completedAt: now },
  })
})

test('two fresh reads for the same user observe the same persisted completed lesson and unlock', () => {
  const context = {
    definitions: [
      { lessonId: 'lesson-01', lessonNumber: 1, prerequisiteLessonId: null },
      { lessonId: 'lesson-02', lessonNumber: 2, prerequisiteLessonId: 'lesson-01' },
    ],
    readiness: [readiness('lesson-01'), readiness('lesson-02')],
    progressRows: [record('lesson-01', { startedAt: now, teachingCompletedAt: now, questionsCompletedAt: now, completedAt: now })],
  }
  const clientARead = buildCantoneseProgressResponse(context)
  const clientBRead = buildCantoneseProgressResponse(context)
  assert.deepEqual(clientARead, clientBRead)
  assert.equal(clientBRead.lessons[0].state, 'COMPLETED')
  assert.equal(clientBRead.lessons[1].state, 'AVAILABLE')
  assert.equal(clientBRead.source, 'SERVER')
})

test('completion stays idempotent after completion and persistence uses unique upsert plus NULL-guarded writes', () => {
  const completed = record('lesson-01', { startedAt: now, teachingCompletedAt: now, questionsCompletedAt: now, completedAt: now })
  assert.deepEqual(transitionCantoneseProgress({ current: completed, action: 'START', now: new Date(now.getTime() + 1000), questionsRequired: true, questionsReady: true }), {
    ok: true, patch: {},
  })
  assert.deepEqual(transitionCantoneseProgress({ current: completed, action: 'COMPLETE', now: new Date(now.getTime() + 1000), questionsRequired: true, questionsReady: true }), {
    ok: true, patch: {},
  })
  const route = readFileSync(path.join(root, 'app/api/learning/cantonese/progress/[lessonId]/route.ts'), 'utf8')
  assert.match(route, /cantoneseLessonProgress\.upsert/)
  assert.match(route, /updateMany\([\s\S]*\[field\]: null/)
})

test('progress endpoints require the current request user and never accept a target user ID', () => {
  const getRoute = readFileSync(path.join(root, 'app/api/learning/cantonese/progress/route.ts'), 'utf8')
  const postRoute = readFileSync(path.join(root, 'app/api/learning/cantonese/progress/[lessonId]/route.ts'), 'utf8')
  assert.match(getRoute, /requireRequestUser\(request\)/)
  assert.match(getRoute, /loadCantoneseProgressContext\(guard\.user\.id\)/)
  assert.match(postRoute, /requireRequestUser\(request\)/)
  assert.match(postRoute, /userId: guard\.user\.id/)
  assert.doesNotMatch(postRoute, /body\?\.userId|body\.userId/)
  assert.doesNotMatch(postRoute, /completed\s*:\s*true/)
  assert.match(postRoute, /assessmentAvailability === 'READY' && readiness\.approvedQuestionCount > 0/)
})

test('Mobile Bearer middleware opens only progress GET and lesson POST routes', async () => {
  process.env.JWT_SECRET = 'cantonese-progress-middleware-test-secret'
  const { middleware } = await import('../middleware')
  const headers = { authorization: 'Bearer test-token' }
  const base = 'https://ecfc.fans/api/learning/cantonese/progress'

  assert.equal((await middleware(new NextRequest(base, { headers }))).status, 200)
  assert.equal((await middleware(new NextRequest(`${base}/lesson-05`, { method: 'POST', headers }))).status, 200)
  assert.equal((await middleware(new NextRequest(base))).status, 401)
  assert.equal((await middleware(new NextRequest(`${base}/lesson-05`, { method: 'PATCH', headers }))).status, 401)
  assert.equal((await middleware(new NextRequest(`${base}/other`, { method: 'POST', headers }))).status, 401)
})
