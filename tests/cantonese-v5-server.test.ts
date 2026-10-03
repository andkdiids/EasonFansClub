import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { assistSuggestion, reliableJyutping, suggestedContentType, type ApprovedMatch } from '../lib/cantonese-content-assist'
import { parseTeachingCreate } from '../lib/cantonese-content-admin'
import { parseCandidateImport } from '../lib/cantonese-candidate-import'
import { resolveCantoneseCourseReadiness } from '../lib/cantonese-course-readiness'

const read = (path: string) => readFileSync(path, 'utf8')
const approved: ApprovedMatch = {
  externalId: 'approved-1', displayText: '你好', body: '你好', jyutping: 'nei5 hou2',
  contentType: 'WORD', lessonId: 'lesson-01', stageId: 'tone-introduction',
  requiresAudio: true, requiresSpeaking: false,
}

test('assist copies Jyutping only from an exact approved match and avoids content/audio IDs already used', () => {
  assert.equal(reliableJyutping('你好', [approved]), 'nei5 hou2')
  assert.equal(reliableJyutping('你好', [{ ...approved, displayText: '你好啊', body: '你好啊' }]), null)
  assert.equal(reliableJyutping('你好', [approved, { ...approved, jyutping: 'nei5 hou3' }]), null)
  const first = assistSuggestion({ text: '你好', matches: [approved], usedIds: new Set(), nextSortOrder: 7 })!
  const second = assistSuggestion({ text: '你好', matches: [approved], usedIds: new Set([first.externalId, first.audioId!]), nextSortOrder: 8 })!
  assert.equal(first.jyutping, 'nei5 hou2')
  assert.equal(first.sectionId, 'tone-introduction')
  assert.equal(first.sortOrder, 7)
  assert.notEqual(second.externalId, first.externalId)
  assert.notEqual(second.audioId, first.audioId)
  assert.equal(first.status, 'CONTENT_REVIEW_REQUIRED')
})

test('short Cantonese utterances suggest a speakable sentence without fabricating Jyutping', () => {
  for (const text of ['今日好熱', '食咗飯未']) {
    assert.equal(suggestedContentType(text), 'SENTENCE')
    const suggestion = assistSuggestion({ text, matches: [], usedIds: new Set(), nextSortOrder: 0 })!
    assert.equal(suggestion.jyutping, null)
    assert.equal(suggestion.jyutpingNeedsConfirmation, true)
    assert.equal(suggestion.requiresSpeaking, true)
    assert.equal(suggestion.requiresAudio, true)
    assert.equal(suggestion.status, 'CONTENT_REVIEW_REQUIRED')
  }
})

test('authoring and seed import reject speaking without audio', () => {
  const teaching = {
    externalId: 'speak-1', lessonId: 'lesson-01', stageId: 'tone-introduction',
    stepId: 'step-1', title: '你好', body: '你好', displayText: '你好',
    requiresSpeaking: true, requiresAudio: false,
  }
  assert.equal(parseTeachingCreate(teaching), null)
  const result = parseCandidateImport(JSON.stringify({ teaching: [teaching], questions: [], audio: [] }))
  assert.equal(result instanceof Response, true)
  assert.equal((result as Response).status, 400)
})

test('preview shares import validation and only reads existing identifiers', () => {
  const preview = read('app/api/admin/cantonese/review/import/preview/route.ts')
  const importer = read('app/api/admin/cantonese/review/import/route.ts')
  assert.match(preview, /parseCandidateImport\(/)
  assert.match(importer, /parseCandidateImport\(/)
  assert.match(preview, /@\/lib\/cantonese-candidate-import/)
  assert.match(importer, /@\/lib\/cantonese-candidate-import/)
  assert.doesNotMatch(preview, /createMany|\.create\(|\.update\(|\$transaction/)
  assert.match(preview, /requireRequestAdmin\(request, 'cantonese_review'\)/)
})

test('public course and speaking exclude pending or unusable audio and expose explicit empty state', () => {
  const course = read('app/api/learning/cantonese/course/route.ts')
  const speaking = read('app/api/learning/cantonese/speaking/route.ts')
  const review = read('app/api/admin/cantonese/review/[type]/[id]/route.ts')
  for (const source of [course, speaking]) {
    assert.match(source, /status: 'APPROVED'/)
    assert.match(source, /assetStatus: 'READY'/)
    assert.match(source, /checksum: \{ not: null \}/)
    assert.match(source, /fileSize: \{ not: null \}/)
    assert.match(source, /EMPTY_CONTENT/)
  }
  assert.match(course, /lessons,/)
  assert.match(course, /lessonContents: publicContents/)
  assert.match(course, /courseReadiness,/)
  assert.match(speaking, /requiresSpeaking: true, requiresAudio: true/)
  assert.match(review, /current\.requiresSpeaking && !current\.requiresAudio/)
  assert.match(review, /audio\.status !== 'APPROVED'/)
  assert.match(review, /AUDIO_NOT_READY/)
})

test('readiness is per lesson, keeps pending text private, and separates teaching from assessment', () => {
  const teaching = [
    { externalId: 'l01-a', lessonId: 'lesson-01', status: 'APPROVED' as const, requiresAudio: true, requiresSpeaking: false, audioId: 'sound-a' },
    { externalId: 'l01-b', lessonId: 'lesson-01', status: 'CONTENT_REVIEW_REQUIRED' as const, requiresAudio: false, requiresSpeaking: false, audioId: null },
    { externalId: 'l01-rejected', lessonId: 'lesson-01', status: 'REJECTED' as const, requiresAudio: false, requiresSpeaking: false, audioId: null },
    { externalId: 'l02-a', lessonId: 'lesson-02', status: 'APPROVED' as const, requiresAudio: false, requiresSpeaking: false, audioId: null },
  ]
  const questions = [
    { externalId: 'q01-a', lessonId: 'lesson-01', status: 'APPROVED' as const },
    { externalId: 'q01-b', lessonId: 'lesson-01', status: 'CONTENT_REVIEW_REQUIRED' as const },
  ]
  const initial = resolveCantoneseCourseReadiness({ teaching, questions, readyAudioIds: new Set(), visibleQuestionIds: new Set(['q01-a']) })
  assert.deepEqual(initial[0], {
    lessonId: 'lesson-01', status: 'CONTENT_NOT_READY', contentCount: 2, approvedContentCount: 1,
    requiredAudioCount: 1, readyAudioCount: 0, questionCount: 2, approvedQuestionCount: 1,
    assessmentAvailability: 'REVIEW_PENDING',
  })
  assert.equal(initial[1].status, 'READY')
  assert.equal(initial[1].assessmentAvailability, 'REVIEW_PENDING')
  assert.equal(initial[2].status, 'CONTENT_NOT_READY')

  const approved = resolveCantoneseCourseReadiness({
    teaching: teaching.map((row) => row.externalId === 'l01-b' ? { ...row, status: 'APPROVED' as const } : row),
    questions: questions.map((row) => ({ ...row, status: 'APPROVED' as const })),
    readyAudioIds: new Set(['sound-a']), visibleQuestionIds: new Set(['q01-a', 'q01-b']),
  })
  assert.equal(approved[0].status, 'READY')
  const invalidSpeaking = resolveCantoneseCourseReadiness({ teaching: [{ ...teaching[3], requiresSpeaking: true }], questions: [], readyAudioIds: new Set(), visibleQuestionIds: new Set() })
  assert.equal(invalidSpeaking[1].status, 'CONTENT_NOT_READY')
  assert.equal(approved[0].assessmentAvailability, 'READY')
  assert.equal(approved[0].approvedQuestionCount, 2)
})

test('Mobile Bearer reaches V5 course, speaking and admin authoring routes before route-level guards', () => {
  const middleware = read('middleware.ts')
  for (const path of [
    '/api/learning/cantonese/course',
    '/api/learning/cantonese/speaking',
    '/api/admin/cantonese/assist',
    '/api/admin/cantonese/review/import/preview',
  ]) assert.ok(middleware.includes(`pathname === '${path}'`), `${path} is missing from exact Bearer allowlist`)
  assert.match(middleware, /if \(isMobileBearerBusinessRequest\(request, pathname\)\) \{/)
  assert.match(read('app/api/admin/cantonese/assist/route.ts'), /requireRequestAdmin\(request, 'cantonese_review'\)/)
  assert.match(read('app/api/admin/cantonese/assist/route.ts'), /suggestion: \{ \.\.\.suggestion, recommendedStageId \}/)
  assert.match(read('app/api/admin/cantonese/review/import/preview/route.ts'), /requireRequestAdmin\(request, 'cantonese_review'\)/)
})
