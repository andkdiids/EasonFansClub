import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { cantoneseJyutpingReviewDigest, cantoneseJyutpingReviewStatus } from '../lib/cantonese-jyutping-review'
import { validateCantoneseQuestionQuality } from '../lib/cantonese-question-quality'
import { parseCandidateImport } from '../lib/cantonese-candidate-import'
import { parseQuestionCreate } from '../lib/cantonese-content-admin'

const read = (path: string) => readFileSync(path, 'utf8')

test('spoken content and audio require verification of the exact text/Jyutping pair', () => {
  const digest = cantoneseJyutpingReviewDigest('早晨', 'zou2 san4')!
  assert.equal(cantoneseJyutpingReviewStatus({ text: '早晨', jyutping: 'zou2 san4', needsJyutping: true, verificationReason: digest }), 'VERIFIED')
  assert.equal(cantoneseJyutpingReviewStatus({ text: '早晨', jyutping: 'zou2 san4', needsJyutping: true }), 'JYUTPING_REVIEW_REQUIRED')
  assert.equal(cantoneseJyutpingReviewStatus({ text: '早晨啊', jyutping: 'zou2 san4', needsJyutping: true, verificationReason: digest }), 'JYUTPING_REVIEW_REQUIRED')
  assert.equal(cantoneseJyutpingReviewStatus({ text: null, jyutping: null, needsJyutping: true }), 'JYUTPING_REVIEW_REQUIRED')
  assert.equal(cantoneseJyutpingReviewStatus({ text: '概念', jyutping: null, needsJyutping: false }), 'NOT_REQUIRED')
})

test('audio generation and single/batch approval enforce the Jyutping quality gate', () => {
  const generate = read('app/api/admin/cantonese/audio/[audioId]/generate/route.ts')
  const detail = read('app/api/admin/cantonese/review/[type]/[id]/route.ts')
  const batch = read('app/api/admin/cantonese/review/batch/route.ts')
  assert.match(generate, /JYUTPING_REVIEW_REQUIRED/)
  assert.match(generate, /CANTONESE_JYUTPING_REVIEW_ACTION/)
  assert.match(detail, /current\.requiresAudio \|\| current\.requiresSpeaking[\s\S]*hasJyutpingVerification/)
  assert.match(detail, /AUDIO_CONTENT_MISMATCH/)
  assert.match(detail, /validateCantoneseQuestionQuality/)
  assert.match(batch, /CANTONESE_JYUTPING_REVIEW_ACTION/)
  assert.match(batch, /isLatestJyutpingVerification\(verificationLogs, digest\)/)
  assert.match(batch, /teachingAudioReady/)
})

test('candidate import labels spoken content/audio as unverified and cannot trust client approval claims', () => {
  const text = {
    externalId: 'cantonese.v6.content.lesson-05.early-greeting', lessonId: 'lesson-05', stageId: 'greetings-basic',
    stepId: 'early-greeting', title: '早晨', body: '早上见面时的问候语。', displayText: '早晨', jyutping: null,
    audioId: 'cantonese.v6.audio.lesson-05.early-greeting', requiresAudio: true, requiresSpeaking: true, jyutpingReviewStatus: 'VERIFIED',
  }
  const audio = {
    externalId: text.audioId, lessonId: 'lesson-05', stageId: 'greetings-basic',
    contentId: text.externalId, text: '早晨', jyutping: '', reviewStatus: 'APPROVED', assetStatus: 'READY',
  }
  const parsed = parseCandidateImport(JSON.stringify({ selectedLessonId: 'lesson-05', definitions: [], teaching: [text], questions: [], audio: [audio] }))
  assert.equal(parsed instanceof Response, false)
  if (parsed instanceof Response) return
  assert.equal(parsed.teaching[0].status, 'CONTENT_REVIEW_REQUIRED')
  assert.equal(parsed.teaching[0].reviewNote, 'JYUTPING_REVIEW_REQUIRED')
  assert.equal(parsed.audio[0].status, 'CONTENT_REVIEW_REQUIRED')
  assert.equal(parsed.audio[0].assetStatus, 'NOT_GENERATED')
  assert.equal(parsed.audio[0].reviewNote, 'JYUTPING_REVIEW_REQUIRED')
})

test('question validator checks answer and distractor structure for supported types', () => {
  const options = [{ id: 'a', text: '答案甲' }, { id: 'b', text: '答案乙' }, { id: 'c', text: '答案丙' }]
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'SINGLE_SELECT', options, correctAnswer: ['a'] }), null)
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'MULTI_SELECT', options, correctAnswer: ['a', 'b'] }), null)
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'MULTI_SELECT', options, correctAnswer: ['a'] }), 'MULTI_SELECT_REQUIRES_TWO_ANSWERS')
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'MULTI_SELECT', options, correctAnswer: ['a', 'b', 'c'] }), 'MULTI_SELECT_CANNOT_MARK_ALL_OPTIONS_CORRECT')
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'SINGLE_SELECT', options, correctAnswer: ['missing'] }), 'ANSWER_NOT_IN_OPTIONS')
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'LISTENING', options, correctAnswer: ['a'] }), 'LISTENING_AUDIO_REQUIRED')
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'SPEAKING', options: [], correctAnswer: [], audioId: 'a-1', speakingReferenceId: 'c-1' }), null)
  assert.equal(validateCantoneseQuestionQuality({ questionType: 'SPEAKING', options, correctAnswer: ['a'], audioId: 'a-1', speakingReferenceId: 'c-1' }), 'SPEAKING_MUST_BE_UNSCORED')
  const question = {
    externalId: 'q-1', lessonId: 'lesson-05', stageId: 'greetings-basic', questionType: 'MULTI_SELECT',
    prompt: '选择两项', options, correctAnswer: ['a', 'b'], explanation: '说明', prerequisiteContentIds: ['content-1'], sortOrder: 0,
  }
  assert.ok(parseQuestionCreate(question))
  assert.equal(parseQuestionCreate({ ...question, correctAnswer: ['not-an-option'] }), null)
})
