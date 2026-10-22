import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { gradeCantoneseAnswer, nextCantoneseQuestionMastery, parseCantoneseAnswerIds } from '../lib/cantonese-answer'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const options = [
  { id: 'a', text: '早晨' }, { id: 'b', text: '多謝' },
  { id: 'c', text: '唔該' }, { id: 'd', text: '拜拜' },
]

test('single choice and listening grading return a Server-owned correction', () => {
  assert.equal(gradeCantoneseAnswer({ questionType: 'SINGLE_SELECT', options, selectedOptionIds: ['a'], correctAnswer: ['a'] })?.correct, true)
  assert.equal(gradeCantoneseAnswer({ questionType: 'LISTENING', options, selectedOptionIds: ['b'], correctAnswer: ['a'] })?.correct, false)
  assert.equal(gradeCantoneseAnswer({ questionType: 'SINGLE_SELECT', options, selectedOptionIds: ['a', 'b'], correctAnswer: ['a'] }), null)
})

test('multi-select grading compares sets and rejects duplicate or unknown option IDs', () => {
  assert.equal(gradeCantoneseAnswer({ questionType: 'MULTI_SELECT', options, selectedOptionIds: ['b', 'a'], correctAnswer: ['a', 'b'] })?.correct, true)
  assert.equal(gradeCantoneseAnswer({ questionType: 'MULTI_SELECT', options, selectedOptionIds: ['a', 'a'], correctAnswer: ['a'] }), null)
  assert.equal(gradeCantoneseAnswer({ questionType: 'TRUE_FALSE', options, selectedOptionIds: ['missing'], correctAnswer: ['a'] }), null)
  assert.equal(parseCantoneseAnswerIds(['a', 'a']), null)
})

test('three consecutive correct answers mark mastery; a later wrong answer resets it', () => {
  assert.deepEqual(nextCantoneseQuestionMastery({ wrongCount: 2, consecutiveCorrect: 1 }, true), {
    wrongCount: 2, consecutiveCorrect: 2, mastery: 'LEARNING',
  })
  assert.deepEqual(nextCantoneseQuestionMastery({ wrongCount: 2, consecutiveCorrect: 2 }, true), {
    wrongCount: 2, consecutiveCorrect: 3, mastery: 'MASTERED',
  })
  assert.deepEqual(nextCantoneseQuestionMastery({ wrongCount: 2, consecutiveCorrect: 3 }, false), {
    wrongCount: 3, consecutiveCorrect: 0, mastery: 'LEARNING',
  })
})

test('answer and review routes enforce user auth, approved content, and private response caching', () => {
  const answerRoute = read('app/api/learning/cantonese/questions/[questionId]/answer/route.ts')
  const reviewRoute = read('app/api/learning/cantonese/review/route.ts')
  assert.match(answerRoute, /requireRequestUser\(request\)/)
  assert.match(answerRoute, /question\.status !== 'APPROVED'/)
  assert.match(answerRoute, /questionType: true, options: true, correctAnswer: true/)
  assert.match(answerRoute, /mode === 'REVIEW'/)
  assert.match(answerRoute, /status: 'APPROVED'/)
  assert.match(answerRoute, /NO_STORE/)
  assert.match(reviewRoute, /requireRequestUser\(request\)/)
  assert.match(reviewRoute, /userId: guard\.user\.id/)
  assert.match(reviewRoute, /status: 'APPROVED'/)
  assert.match(reviewRoute, /statusFilter: 'APPROVED_ONLY'/)
  assert.match(reviewRoute, /questionId/)
  assert.match(reviewRoute, /orderBy: \[\{ wrongCount: 'desc' \}, \{ lastWrongAt: 'desc' \}/)
})

test('Mobile Bearer middleware admits learning review and gradeable answer routes while preserving existing allowlists', () => {
  const middleware = read('middleware.ts')
  assert.match(middleware, /pathname === '\/api\/learning\/cantonese\/review'/)
  assert.match(middleware, /questions.+answer/)
  assert.match(middleware, /pathname === '\/api\/growth'/)
  assert.match(middleware, /direct-conversations/)
  assert.match(middleware, /pathname === '\/api\/admin\/review'/)
})

test('course response hides answer keys and completion requires Server-recorded attempts', () => {
  const courseRoute = read('app/api/learning/cantonese/course/route.ts')
  const progressRoute = read('app/api/learning/cantonese/progress/[lessonId]/route.ts')
  assert.match(courseRoute, /options: true, correctAnswer: true, explanation: true, prerequisiteContentIds: true/)
  assert.match(courseRoute, /correctAnswer: true/)
  assert.match(courseRoute, /correctAnswer: _correctAnswer/)
  assert.match(courseRoute, /gradeCantoneseAnswer/)
  assert.match(courseRoute, /void _correctAnswer/)
  assert.match(progressRoute, /cantoneseLearnerQuestionProgress/)
  assert.match(progressRoute, /QUESTIONS_NOT_ANSWERED/)
  assert.match(progressRoute, /gradeCantoneseAnswer/)
  assert.match(read('prisma/schema.prisma'), /lastAnswerCorrect\s+Boolean/)
  assert.match(read('prisma/migrations/20261023090000_cantonese_question_progress/migration.sql'), /lastAnswerCorrect/)
})

test('learner question progress is user-scoped and cascade-linked to its source question', () => {
  const schema = read('prisma/schema.prisma')
  const model = schema.match(/model CantoneseLearnerQuestionProgress \{([\s\S]*?)^\}/m)?.[1] ?? ''
  assert.ok(model)
  const normalized = model.replace(/\s+/g, ' ')
  for (const field of ['userId String', 'questionId String', 'attemptCount Int', 'correctCount Int', 'wrongCount Int',
    'consecutiveCorrect Int', 'mastery String', 'lastWrongAt DateTime?', 'lastCorrectAt DateTime?', 'lastAnsweredAt DateTime?',
    'lastAnswerCorrect Boolean', 'lastWrongAnswer Json?', 'user User', 'question CantoneseQuestion']) {
    assert.ok(normalized.includes(field), `missing learner progress field ${field}`)
  }
  assert.match(model, /@@unique\(\[userId, questionId\]\)/)
  assert.match(model, /onDelete: Cascade/)
})
