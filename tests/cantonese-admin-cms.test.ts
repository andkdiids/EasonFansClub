import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20261002120000_add_cantonese_content_management/migration.sql')
const content = read('app/api/admin/cantonese/content/route.ts')
const questions = read('app/api/admin/cantonese/questions/route.ts')
const audio = read('app/api/admin/cantonese/audio/route.ts')
const generate = read('app/api/admin/cantonese/audio/[audioId]/generate/route.ts')
const review = read('app/api/admin/cantonese/review/[type]/[id]/route.ts')
const middleware = read('middleware.ts')
const reviewLogic = read('lib/cantonese-review.ts')

test('CMS schema exposes content authoring and audio synthesis metadata without signed URLs', () => {
  assert.match(schema, /contentType\s+String\s+@default\("CONCEPT"\)/)
  assert.match(schema, /requiresAudio\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /requiresSpeaking\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /speakingReferenceId\s+String\?/)
  assert.match(schema, /audioKey\s+String\?\s+@unique/)
  assert.match(schema, /voiceProfile\s+String\s+@default\("101019"\)/)
  assert.match(schema, /sampleRate\s+Int\s+@default\(16000\)/)
  assert.doesNotMatch(schema, /signedUrl|audioUrl\s+String/)
})

test('new migration is additive and does not recreate or drop existing tables', () => {
  assert.doesNotMatch(migration, /CREATE TABLE|DROP TABLE|DROP COLUMN|RENAME COLUMN/i)
  assert.match(migration, /ADD COLUMN `contentType`/)
  assert.match(migration, /ADD COLUMN `audioKey`/)
  assert.match(migration, /CREATE UNIQUE INDEX `CantoneseAudioAsset_audioKey_key`/)
})

test('CMS mutations require the existing cantonese_review permission and default to pending review', () => {
  for (const source of [content, questions, audio]) {
    assert.match(source, /requireRequestAdmin\(request, 'cantonese_review'\)/)
    assert.match(source, /CONTENT_REVIEW_REQUIRED/)
  }
  assert.match(generate, /requireRequestAdmin\(request, 'cantonese_review'\)/)
  assert.match(generate, /status: 'CONTENT_REVIEW_REQUIRED'/)
})

test('approved content edits return it to review and invalidate generated audio metadata', () => {
  assert.match(review, /nextCantoneseReviewStatus\(current\.status, 'edit'\)/)
  assert.match(review, /audioKey: null/)
  assert.match(review, /assetStatus: 'NEEDS_REGENERATION'/)
  assert.match(review, /nextCantoneseAudioVersion\(current\.audioVersion\)/)
  assert.match(reviewLogic, /export function nextCantoneseAudioVersion/)
})

test('audio generation is deterministic, COS-backed, and never stores a signed URL', () => {
  assert.match(generate, /foundationAudioObjectKey\(current\.text, runtimeConfig\)/)
  assert.match(generate, /createFoundationAudioStorage\(config\)/)
  assert.match(generate, /storage\.exists\(cosKey\)/)
  assert.match(generate, /storage\.read\(cosKey\)/)
  assert.match(generate, /createHash\('sha256'\)\.update\(cachedAudio\)/)
  assert.match(generate, /storage\.upload\(cosKey, audio\)/)
  assert.match(generate, /storage\.signedUrl\(cosKey\)/)
  assert.match(generate, /createHash\('sha256'\)\.update\(cosKey\)/)
})

test('mobile Bearer allow-through covers only the new CMS mutations and speech assessment path', () => {
  assert.match(middleware, /pathname === '\/api\/admin\/cantonese\/content'/)
  assert.match(middleware, /pathname === '\/api\/admin\/cantonese\/questions'/)
  assert.match(middleware, /pathname === '\/api\/admin\/cantonese\/audio'/)
  assert.ok(middleware.includes("|| /^\\/api\\/admin\\/cantonese\\/audio\\/[^/]+\\/generate$/.test(pathname)"))
  assert.match(middleware, /\/api\/learning\/cantonese\/speech\/assess/)
})
