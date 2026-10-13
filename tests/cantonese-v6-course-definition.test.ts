import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveCantoneseCourseReadiness } from '../lib/cantonese-course-readiness'

const read = (path: string) => readFileSync(path, 'utf8')

test('public course definitions are data-driven, approved-only, and allow future lesson numbers', () => {
  const route = read('app/api/learning/cantonese/course/route.ts')
  assert.match(route, /\^lesson-\\d\{2,3\}\$/)
  assert.match(route, /cantoneseCourseDefinition\.findMany\([\s\S]*where: \{ status: 'APPROVED' \}/)
  assert.match(route, /courses: courseDefinitions/)
  const ready = resolveCantoneseCourseReadiness({
    lessonIds: ['lesson-05', 'lesson-06', 'lesson-07'], teaching: [], questions: [], readyAudioIds: new Set(), visibleQuestionIds: new Set(),
  })
  assert.deepEqual(ready.map((item) => item.lessonId), ['lesson-05', 'lesson-06', 'lesson-07'])
  assert.ok(ready.every((item) => item.status === 'CONTENT_NOT_READY'))
})

test('course API preserves authored sections and exposes questions in a separate quiz section', () => {
  const route = read('app/api/learning/cantonese/course/route.ts')
  assert.match(route, /item\.section\?\.trim\(\) \|\| item\.stageId/)
  assert.match(route, /const quizSectionId = '07-小测'/)
  assert.match(route, /questions: sectionId === quizSectionId \? lessonQuestionsForLesson : \[\]/)
})

test('course definitions use review-gated states and admin routes require cantonese_review', () => {
  const schema = read('prisma/schema.prisma')
  const adminGet = read('app/api/admin/cantonese/courses/route.ts')
  const adminPatch = read('app/api/admin/cantonese/courses/[lessonId]/route.ts')
  assert.match(schema, /enum CantoneseCourseStatus \{[\s\S]*?DRAFT\s+CONTENT_REVIEW_REQUIRED\s+APPROVED\s+ARCHIVED/)
  for (const route of [adminGet, adminPatch]) {
    assert.match(route, /requireRequestAdmin\(request, 'cantonese_review'\)/)
    assert.match(route, /FORBIDDEN/)
  }
  assert.match(adminPatch, /status: 'CONTENT_REVIEW_REQUIRED'/)
  assert.match(adminPatch, /newStatus: body\.action === 'approve' \? 'APPROVED' : 'CONTENT_REVIEW_REQUIRED'/)
})

test('V6 migration is additive and contains no destructive SQL', () => {
  const sql = read('prisma/migrations/20261004100000_add_cantonese_course_definition/migration.sql')
  assert.match(sql, /CREATE TABLE `CantoneseCourseDefinition`/)
  assert.match(sql, /ALTER TABLE `CantoneseLessonContent` ADD COLUMN/)
  assert.match(sql, /ALTER TABLE `CantoneseQuestion` ADD COLUMN/)
  assert.doesNotMatch(sql, /\b(DROP|RENAME|TRUNCATE|DELETE\s+FROM)\b|\bCHANGE\s+COLUMN\b/i)
})
