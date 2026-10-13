import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseCandidateImport } from '../lib/cantonese-candidate-import'
import { planSeedRows, summarizeSeedPlan } from '../lib/cantonese-seed-import'

const approved = (externalId: string, data: Record<string, unknown>) => ({ externalId, status: 'APPROVED', ...data })

test('approved teaching, question and audio with the same externalId remain immutable', () => {
  for (const type of ['teaching', 'question', 'audio'] as const) {
    const same = planSeedRows([{ externalId: `${type}-1`, text: 'existing' }], [approved(`${type}-1`, { text: 'existing' })], type)
    assert.equal(same[0].decision, 'SKIPPED_ALREADY_APPROVED')
    const changed = planSeedRows([{ externalId: `${type}-1`, text: 'candidate' }], [approved(`${type}-1`, { text: 'existing' })], type)
    assert.equal(changed[0].decision, 'UPDATE_AVAILABLE')
    assert.deepEqual(changed[0].diff.map((item) => item.field), ['text'])
    assert.equal(changed[0].diff[0].old, 'existing')
    assert.equal(changed[0].diff[0].next, 'candidate')
  }
  const generatedAudio = planSeedRows(
    [{ externalId: 'ready-audio', text: 'same', audioVersion: 'v1', assetStatus: 'NOT_GENERATED' }],
    [{ externalId: 'ready-audio', status: 'APPROVED', text: 'same', audioVersion: 'v3', assetStatus: 'READY', cosKey: 'asset' }],
    'audio',
  )
  assert.equal(generatedAudio[0].decision, 'SKIPPED_ALREADY_APPROVED')
  const movedLesson = planSeedRows([{ externalId: 'moved', lessonId: 'lesson-06' }], [approved('moved', { lessonId: 'lesson-05' })], 'teaching')
  assert.equal(movedLesson[0].decision, 'UPDATE_AVAILABLE')
  const approvedDefinition = planSeedRows(
    [{ lessonId: 'lesson-05', title: 'Same' }],
    [{ lessonId: 'lesson-05', status: 'APPROVED', title: 'Same' }],
    'definition', 'lessonId',
  )
  assert.equal(approvedDefinition[0].decision, 'SKIPPED_ALREADY_APPROVED')
  const importer = readFileSync('app/api/admin/cantonese/review/import/route.ts', 'utf8')
  assert.match(importer, /decision === 'CREATE_PENDING'/)
  assert.match(importer, /decision === 'CANDIDATE_UPDATE_AVAILABLE'/)
  assert.doesNotMatch(importer, /for \(const row of [^\n]*decision === 'UPDATE_AVAILABLE'/)
})

test('new rows are pending; unchanged candidates are idempotent; unapproved candidate updates preserve status', () => {
  const fresh = planSeedRows([{ externalId: 'new', status: 'CONTENT_REVIEW_REQUIRED', title: 'New' }], [], 'teaching')
  assert.equal(fresh[0].decision, 'CREATE_PENDING')
  assert.equal(summarizeSeedPlan(fresh).willImport, 1)
  const unchanged = planSeedRows([{ externalId: 'old', title: 'Same' }], [{ externalId: 'old', status: 'REJECTED', title: 'Same' }], 'teaching')
  assert.equal(unchanged[0].decision, 'SKIPPED_EXISTING')
  const changed = planSeedRows([{ externalId: 'old', title: 'New' }], [{ externalId: 'old', status: 'REJECTED', title: 'Old' }], 'teaching')
  assert.equal(changed[0].decision, 'CANDIDATE_UPDATE_AVAILABLE')
  assert.equal(changed[0].existing?.status, 'REJECTED')
  const generatedAudio = planSeedRows([{ externalId: 'a', text: 'changed' }], [{ externalId: 'a', status: 'REJECTED', assetStatus: 'READY', cosKey: 'private', text: 'old' }], 'audio')
  assert.equal(generatedAudio[0].decision, 'AUDIO_ASSET_REVIEW_REQUIRED')
})

test('per-lesson import selects only the requested pack, validates lesson/stage and duplicate IDs', () => {
  const teaching = {
    externalId: 'course-v6.lesson05.greeting.001', lessonId: 'lesson-05', stageId: 'greetings-basic',
    stepId: 'greeting-001', title: 'Greeting', body: 'Greeting', displayText: 'Greeting',
    requiresAudio: true, requiresSpeaking: true,
  }
  const question = {
    externalId: 'course-v6.lesson06.question.001', lessonId: 'lesson-06', stageId: 'directions-travel',
    questionType: 'SINGLE_SELECT', prompt: 'Question', explanation: 'Explanation',
    options: ['A', 'B'], correctAnswer: 0, prerequisiteContentIds: [],
  }
  const audio = { externalId: 'course-v6.lesson05.audio.001', lessonId: 'lesson-05', stageId: 'greetings-basic', text: 'Greeting' }
  const parsed = parseCandidateImport(JSON.stringify({ selectedLessonId: 'lesson-05', teaching: [teaching], questions: [question], audio: [audio] }))
  assert.equal(parsed instanceof Response, false)
  if (parsed instanceof Response) return
  assert.equal(parsed.teaching.length, 1)
  assert.equal(parsed.questions.length, 0)
  assert.equal(parsed.audio.length, 1)
  assert.equal(parsed.teaching[0].status, 'CONTENT_REVIEW_REQUIRED')
  assert.equal(parsed.audio[0].assetStatus, 'NOT_GENERATED')
  const mismatched = parseCandidateImport(JSON.stringify({ teaching: [{ ...teaching, lessonId: 'lesson-07' }], questions: [], audio: [] }))
  assert.equal(mismatched instanceof Response && mismatched.status, 400)
  const duplicate = parseCandidateImport(JSON.stringify({ teaching: [teaching, teaching], questions: [], audio: [] }))
  assert.equal(duplicate instanceof Response && duplicate.status, 400)
})

test('course definitions are pending on import and approved definitions only yield an update proposal', () => {
  const definition = {
    lessonId: 'lesson-07', lessonNumber: 7, title: '餐厅点餐', subtitle: 'Ordering', description: 'Candidate course',
    sortOrder: 7, prerequisiteLessonId: 'lesson-06', status: 'APPROVED',
  }
  const parsed = parseCandidateImport(JSON.stringify({ definitions: [definition], teaching: [], questions: [], audio: [] }))
  assert.equal(parsed instanceof Response, false)
  if (parsed instanceof Response) return
  assert.equal(parsed.definitions[0].status, 'CONTENT_REVIEW_REQUIRED')
  const plan = planSeedRows(parsed.definitions, [{ ...definition, title: 'Older approved title' }], 'definition', 'lessonId')
  assert.equal(plan[0].decision, 'UPDATE_AVAILABLE')
  assert.deepEqual(plan[0].diff.map((row) => row.field), ['title'])
  const importer = readFileSync('app/api/admin/cantonese/review/import/route.ts', 'utf8')
  assert.match(importer, /definitionPlan\.filter\(\(row\) => row\.decision === 'CREATE_PENDING'\)/)
  assert.match(importer, /definitionPlan\.filter\(\(item\) => item\.decision === 'CANDIDATE_UPDATE_AVAILABLE'\)/)
})

test('new lessons can be imported with their own definition without extending a six-lesson whitelist', () => {
  const parsed = parseCandidateImport(JSON.stringify({
    selectedLessonId: 'lesson-08',
    definitions: [{ lessonId: 'lesson-08', lessonNumber: 8, title: '购物', description: 'Candidate', sortOrder: 8, prerequisiteLessonId: 'lesson-07' }],
    teaching: [{ externalId: 'l08-1', lessonId: 'lesson-08', stageId: 'shopping-basic', stepId: 'intro', title: 'Intro', body: 'Intro' }],
    questions: [], audio: [],
  }))
  assert.equal(parsed instanceof Response, false)
  if (parsed instanceof Response) return
  assert.equal(parsed.definitions.length, 1)
  assert.equal(parsed.teaching.length, 1)
  assert.equal(parsed.teaching[0].lessonId, 'lesson-08')
})
