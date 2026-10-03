import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  isBatchApprovalAllowed,
  isCantoneseQuestionType,
  nextCantoneseReviewStatus,
  parseCantoneseReviewAction,
  parseCantoneseReviewEntityType,
  parseCantoneseReviewStatus,
  lessonIdForStage,
  safeReviewReason,
} from '../lib/cantonese-review'

const read = (path: string) => readFileSync(path, 'utf8')

test('review filters accept only known states and types', () => {
  assert.equal(parseCantoneseReviewStatus('APPROVED'), 'APPROVED')
  assert.equal(parseCantoneseReviewStatus('ALL'), 'ALL')
  assert.equal(parseCantoneseReviewStatus('unknown'), 'CONTENT_REVIEW_REQUIRED')
  assert.equal(parseCantoneseReviewEntityType('teaching'), 'teaching')
  assert.equal(parseCantoneseReviewEntityType('other'), null)
  assert.equal(parseCantoneseReviewAction('mark-needs-regeneration'), 'mark-needs-regeneration')
  assert.equal(parseCantoneseReviewAction('delete'), null)
})

test('edit after approval re-enters review and does not rewrite a draft as approved', () => {
  assert.equal(nextCantoneseReviewStatus('APPROVED', 'edit'), 'CONTENT_REVIEW_REQUIRED')
  assert.equal(nextCantoneseReviewStatus('REJECTED', 'edit'), 'CONTENT_REVIEW_REQUIRED')
  assert.equal(nextCantoneseReviewStatus('DRAFT', 'edit'), 'DRAFT')
  assert.equal(nextCantoneseReviewStatus('CONTENT_REVIEW_REQUIRED', 'approve'), 'APPROVED')
  assert.equal(nextCantoneseReviewStatus('CONTENT_REVIEW_REQUIRED', 'reject'), 'REJECTED')
})

test('question kinds and rejection reasons are validated', () => {
  for (const type of ['SINGLE_SELECT', 'MULTI_SELECT', 'LISTENING', 'TRUE_FALSE', 'MATCH', 'ORDER', 'FILL', 'JYUTPING', 'TONE', 'LYRIC_VOCAB', 'LYRIC_GRAMMAR']) assert.equal(isCantoneseQuestionType(type), true)
  assert.equal(isCantoneseQuestionType('SOME_OTHER_TYPE'), false)
  assert.equal(lessonIdForStage('tone-introduction'), 'lesson-01')
  assert.equal(lessonIdForStage('graduation'), 'lesson-06')
  assert.equal(lessonIdForStage('unknown'), null)
  assert.equal(safeReviewReason('  内容需要更正  '), '内容需要更正')
  assert.equal(safeReviewReason('  '), null)
  assert.equal(safeReviewReason('x'.repeat(2001)), null)
})

test('batch approval excludes audio, pronunciation, lyric, and multi-select records', () => {
  assert.equal(isBatchApprovalAllowed({ type: 'audio' }), false)
  assert.equal(isBatchApprovalAllowed({ type: 'teaching' }), false)
  assert.equal(isBatchApprovalAllowed({ type: 'question', questionType: 'MULTI_SELECT' }), false)
  assert.equal(isBatchApprovalAllowed({ type: 'question', questionType: 'LISTENING' }), false)
  assert.equal(isBatchApprovalAllowed({ type: 'question', questionType: 'SINGLE_SELECT', lyricPrescriptionId: 'lyric-1' }), false)
  assert.equal(isBatchApprovalAllowed({ type: 'question', questionType: 'SINGLE_SELECT', prompt: '声调是什么？' }), false)
  assert.equal(isBatchApprovalAllowed({ type: 'question', questionType: 'SINGLE_SELECT', prompt: '课程后台分类标签是否完整？' }), true)
  assert.equal(isBatchApprovalAllowed({ type: 'question', questionType: 'TRUE_FALSE' }), true)
})

test('admin review routes apply the Mobile Bearer-aware permission guard', () => {
  const listRoute = read('app/api/admin/cantonese/review/route.ts')
  const detailRoute = read('app/api/admin/cantonese/review/[type]/[id]/route.ts')
  const previewRoute = read('app/api/admin/cantonese/review/audio/[audioId]/preview/route.ts')
  for (const route of [listRoute, detailRoute, previewRoute]) {
    assert.match(route, /requireRequestAdmin\(request, 'cantonese_review'\)/)
  }
  assert.match(detailRoute, /REJECTION_REASON_REQUIRED/)
  assert.match(detailRoute, /tx\.cantoneseReviewLog\.create/)
  assert.match(detailRoute, /CONTENT_REVIEW_REQUIRED/)
  assert.match(detailRoute, /AUDIO_NOT_READY/)
  assert.match(detailRoute, /assetStatus: 'NEEDS_REGENERATION'/)
})

test('candidate import is admin-only, create-only, and forces every imported item into review', () => {
  const route = read('app/api/admin/cantonese/review/import/route.ts')
  const parser = read('lib/cantonese-candidate-import.ts')
  assert.match(route, /requireRequestAdmin\(request, 'cantonese_review'\)/)
  assert.match(route, /parseCandidateImport\(/)
  assert.match(route, /createMany\(\{ data: teaching, skipDuplicates: true \}\)/)
  assert.match(route, /createMany\(\{ data: questions, skipDuplicates: true \}\)/)
  assert.match(route, /createMany\(\{ data: audio, skipDuplicates: true \}\)/)
  assert.match(route, /status: 'CONTENT_REVIEW_REQUIRED'/)
  assert.match(parser, /assetStatus: 'NOT_GENERATED'/)
  assert.doesNotMatch(route, /status:\s*item\.status|APPROVED/)
})

test('admin list never serializes COS object keys and preview signs only after authorization', () => {
  const listRoute = read('app/api/admin/cantonese/review/route.ts')
  const previewRoute = read('app/api/admin/cantonese/review/audio/[audioId]/preview/route.ts')
  assert.match(listRoute, /const \{ cosKey, \.\.\.safeAsset \} = asset/)
  assert.match(listRoute, /serverSupported: Boolean\(cosKey && asset\.assetStatus === 'READY'\)/)
  assert.match(previewRoute, /getSignedCosObjectUrl\(asset\.cosKey, 180\)/)
  assert.match(previewRoute, /Cache-Control.*private, no-store/)
  assert.doesNotMatch(previewRoute, /console\.(log|error).*audioUrl/)
})

test('public course source filters teaching, questions, and audio to approved records only', () => {
  const route = read('app/api/learning/cantonese/course/route.ts')
  assert.equal((route.match(/status: 'APPROVED'/g) || []).length, 3)
  assert.match(route, /assetStatus: 'READY'/)
  assert.doesNotMatch(route, /correctAnswer: true/)
  assert.doesNotMatch(route, /DRAFT|CONTENT_REVIEW_REQUIRED|REJECTED/)
})

test('schema adds the four review models and the LyricPrescription stable source relation', () => {
  const schema = read('prisma/schema.prisma')
  for (const model of ['CantoneseLessonContent', 'CantoneseQuestion', 'CantoneseAudioAsset', 'CantoneseReviewLog']) {
    assert.match(schema, new RegExp(`model ${model} \\{`))
  }
  assert.match(schema, /enum CantoneseReviewStatus\s*\{\s*DRAFT\s*CONTENT_REVIEW_REQUIRED\s*APPROVED\s*REJECTED/)
  assert.match(schema, /lyricPrescriptionId\s+String\?/)
  assert.match(schema, /LyricPrescription\s+LyricPrescription\?\s+@relation/)
})

test('Bearer middleware allowlist is scoped to Cantonese admin review operations', () => {
  const middleware = read('middleware.ts')
  assert.match(middleware, /pathname === '\/api\/admin\/cantonese\/review'/)
  assert.match(middleware, /\/api\\\/admin\\\/cantonese\\\/review\\\/\(\?:teaching\|question\|audio\)/)
  assert.match(middleware, /pathname === '\/api\/admin\/cantonese\/review\/batch'/)
  assert.match(middleware, /pathname === '\/api\/admin\/cantonese\/review\/import'/)
})
