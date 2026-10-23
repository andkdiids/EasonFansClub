import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { validateCantoneseQuestionQuality } from '../lib/cantonese-question-quality'
import { buildV6CoursePackSeedPayload, findV6CoursePack, LESSON_05_GREETINGS, LESSON_06_DIRECTIONS, LESSON_07_ORDERING, V6_COURSE_PACKS } from '../lib/cantonese-course-packs'
import {
  CANTONESE_AUDIO_MANIFEST,
  CANTONESE_V2_ANSWER_REVIEW_QUEUE,
  CANTONESE_V2_AUDIO_ID_MAPPING,
  CANTONESE_V2_CANDIDATE_COUNTS,
  CANTONESE_V2_CANDIDATE_PACK,
  CANTONESE_V2_CONTENT_MAPPING,
  CANTONESE_V2_FOUNDATION,
  CANTONESE_V2_LESSONS,
  CANTONESE_V2_QUESTION_MAPPING,
  CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE,
} from '../lib/cantonese-course-packs/cantonese-v2-candidate'
import { V6_JYUTPING_CANDIDATES } from '../lib/cantonese-course-packs/jyutping-candidates'

const rawLegacyPacks = [LESSON_05_GREETINGS, LESSON_06_DIRECTIONS, LESSON_07_ORDERING]

test('candidate lessons retain lesson-05–07 IDs and form a valid Foundation → 01–07 sequence', () => {
  assert.deepEqual(CANTONESE_V2_LESSONS.map((item) => [item.order, item.lessonId]), [
    [1, 'lesson-01'], [2, 'lesson-02'], [3, 'lesson-03'], [4, 'lesson-04'], [5, 'lesson-05'], [6, 'lesson-06'], [7, 'lesson-07'],
  ])
  assert.equal(CANTONESE_V2_LESSONS[0].prerequisite, null)
  assert.equal(CANTONESE_V2_LESSONS[0].recommendedFoundationId, CANTONESE_V2_FOUNDATION.id)
  for (let index = 1; index < CANTONESE_V2_LESSONS.length; index += 1) {
    assert.equal(CANTONESE_V2_LESSONS[index].prerequisite, CANTONESE_V2_LESSONS[index - 1].lessonId)
  }
  assert.equal(findV6CoursePack('lesson-05')?.definition.title, '打招呼與基本交流')
  assert.equal(findV6CoursePack('lesson-06')?.definition.title, '問路與出行')
  assert.equal(findV6CoursePack('lesson-07')?.definition.title, '餐廳點餐')
  assert.equal(CANTONESE_V2_CANDIDATE_PACK.mobileLesson05ReviewDecision.decision, 'UNIT_REVIEW')
  assert.equal(CANTONESE_V2_CANDIDATE_PACK.courseUnifiedStatus, 'PARTIAL')
})

test('candidate IDs, prerequisites, question options, and answers are structurally valid', () => {
  const ids = V6_COURSE_PACKS.map((pack) => pack.definition.lessonId)
  assert.equal(new Set(ids).size, ids.length)
  const contentIds = V6_COURSE_PACKS.flatMap((pack) => pack.teaching.map((item) => item.externalId))
  const questionIds = V6_COURSE_PACKS.flatMap((pack) => pack.questions.map((item) => item.externalId))
  const audioIds = V6_COURSE_PACKS.flatMap((pack) => pack.audio.map((item) => item.externalId))
  assert.equal(new Set(contentIds).size, contentIds.length)
  assert.equal(new Set(questionIds).size, questionIds.length)
  assert.equal(new Set(audioIds).size, audioIds.length)

  for (const pack of V6_COURSE_PACKS) {
    const localContentIds = new Set(pack.teaching.map((item) => item.externalId))
    for (const teaching of pack.teaching) assert.equal(teaching.reviewStatus, 'CONTENT_REVIEW_REQUIRED')
    for (const question of pack.questions) {
      assert.equal(question.reviewStatus, 'CONTENT_REVIEW_REQUIRED')
      assert.ok(question.prerequisiteContentIds.every((id) => localContentIds.has(id)), question.externalId)
      assert.equal(validateCantoneseQuestionQuality(question), null, question.externalId)
    }
    assert.ok(pack.teaching.every((item) => item.examples.length === 0), pack.definition.lessonId)
  }
  assert.doesNotMatch(JSON.stringify(CANTONESE_V2_CANDIDATE_PACK), /"(?:APPROVED|PUBLISHED)"/)
})

test('new 01–04 candidates use only supported question types and retain the local content mappings', () => {
  assert.equal(CANTONESE_V2_CONTENT_MAPPING.length, 18)
  assert.equal(CANTONESE_V2_AUDIO_ID_MAPPING.length, 18)
  assert.equal(new Set(CANTONESE_V2_AUDIO_ID_MAPPING.map((item) => item.oldMobileAudioId)).size, 18)
  assert.equal(CANTONESE_V2_QUESTION_MAPPING.length, 36)
  assert.equal(new Set(CANTONESE_V2_CONTENT_MAPPING.map((item) => item.oldMobileId)).size, 18)
  assert.equal(new Set(CANTONESE_V2_QUESTION_MAPPING.map((item) => item.oldMobileExerciseId)).size, 36)
  assert.ok(CANTONESE_V2_QUESTION_MAPPING.every((item) => item.contentIds.length + item.questionIds.length > 0))
  assert.ok(V6_COURSE_PACKS.slice(0, 4).flatMap((pack) => pack.questions).every((item) => item.questionType === 'SINGLE_SELECT'))
  assert.deepEqual(
    CANTONESE_V2_CONTENT_MAPPING.filter((item) => item.classification !== 'UNIQUE').map((item) => [item.oldMobileId, item.classification, item.recommendation]),
    [['greeting_hello', 'DUPLICATE', 'MERGE'], ['greeting_morning', 'DUPLICATE', 'MERGE'], ['greeting_bye', 'PARTIAL_OVERLAP', 'KEEP']],
  )
})

test('all 80 missing legacy Jyutping rows receive explicit review-only candidates', () => {
  const missing = rawLegacyPacks.flatMap((pack) => pack.teaching.filter((item) => item.displayText && !item.jyutping))
  assert.equal(missing.length, 80)
  assert.equal(V6_JYUTPING_CANDIDATES.length, 80)
  assert.equal(new Set(V6_JYUTPING_CANDIDATES.map((item) => item.contentId)).size, 80)
  const candidateById = new Map(V6_JYUTPING_CANDIDATES.map((item) => [item.contentId, item]))
  for (const item of missing) {
    const candidate = candidateById.get(item.externalId)
    assert.ok(candidate, `missing candidate for ${item.externalId}`)
    assert.equal(candidate.status, 'HUMAN_REVIEW_REQUIRED')
    assert.ok(candidate.candidate.trim().length > 0)
    assert.match(candidate.candidate, /[1-6]/)
  }
  const alreadyPresent = rawLegacyPacks.flatMap((pack) => pack.teaching.filter((item) => item.displayText && item.jyutping))
  assert.equal(alreadyPresent.length, 18)
  assert.ok(V6_JYUTPING_CANDIDATES.filter((item) => item.ambiguousReason).length > 0)
})

test('audio manifest preserves stable IDs and prevents fake readiness or listening unlocks', () => {
  assert.equal(CANTONESE_V2_CANDIDATE_COUNTS.realAudio, 0)
  assert.equal(CANTONESE_AUDIO_MANIFEST.length, 126)
  assert.equal(new Set(CANTONESE_AUDIO_MANIFEST.map((item) => item.audioId)).size, CANTONESE_AUDIO_MANIFEST.length)
  assert.ok(CANTONESE_AUDIO_MANIFEST.every((item) => item.status === 'PENDING_TEXT_APPROVAL' && item.jyutpingStatus === 'PENDING_JYUTPING_APPROVAL' && !item.realAudio))
  assert.ok(CANTONESE_AUDIO_MANIFEST.every((item) => item.lessonId && item.contentId && item.text && item.jyutping))
  const listening = V6_COURSE_PACKS.flatMap((pack) => pack.questions.filter((item) => item.questionType === 'LISTENING'))
  assert.equal(listening.length, 9)
  assert.ok(listening.every((item) => item.audioId && CANTONESE_AUDIO_MANIFEST.some((audio) => audio.audioId === item.audioId)))
  assert.ok(V6_COURSE_PACKS.flatMap((pack) => pack.questions).filter((item) => item.questionType === 'SPEAKING').every((item) => item.correctAnswer.length === 0 && item.options.length === 0))
  assert.equal(CANTONESE_V2_FOUNDATION.questions.filter((item) => item.questionType === 'LISTENING' && item.readiness === 'BLOCKED_BY_AUDIO').length, 1)
})

test('answer-review queues identify exactly the 4 ambiguous and 7 shallow existing questions', () => {
  assert.equal(CANTONESE_V2_ANSWER_REVIEW_QUEUE.length, 4)
  assert.equal(CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE.length, 7)
  assert.ok(CANTONESE_V2_ANSWER_REVIEW_QUEUE.every((item) => item.status === 'HUMAN_REVIEW_REQUIRED' && item.currentAnswer.length > 0))
  assert.ok(CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE.every((item) => item.status === 'HUMAN_REVIEW_REQUIRED' && item.currentExplanation !== item.suggestedExplanation))
})

test('seed/runtime contracts stay compatible, answer keys remain private, and import remains pending', () => {
  for (const pack of V6_COURSE_PACKS) {
    const payload = buildV6CoursePackSeedPayload(pack.definition.lessonId)
    assert.equal(payload.definitions[0].lessonId, pack.definition.lessonId)
    assert.equal(payload.teaching.length, pack.teaching.length)
    assert.equal(payload.questions.length, pack.questions.length)
    assert.equal(payload.audio.length, pack.audio.length)
    assert.ok(payload.definitions.every((item) => item.status === 'CONTENT_REVIEW_REQUIRED'))
  }
  const publicCourseRoute = readFileSync('app/api/learning/cantonese/course/route.ts', 'utf8')
  assert.match(publicCourseRoute, /map\(\(\{ correctAnswer: _correctAnswer, \.\.\.item \}\)/)
  assert.match(publicCourseRoute, /void _correctAnswer/)
})
