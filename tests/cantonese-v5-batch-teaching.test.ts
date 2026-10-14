import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { teachingAudioReady } from '../lib/cantonese-content-admin'

const withoutAudio = { requiresAudio: false, requiresSpeaking: false, audioId: null }
const withAudio = { requiresAudio: true, requiresSpeaking: true, audioId: 'lesson01.word.audio' }
const readyAudio = {
  externalId: 'lesson01.word.audio', status: 'APPROVED', assetStatus: 'READY',
  cosKey: 'cantonese/audio/example.mp3', checksum: 'checksum', fileSize: 123,
}

test('teaching batch approval requires ready and approved linked audio when requested', () => {
  assert.equal(teachingAudioReady(withoutAudio, null), true)
  assert.equal(teachingAudioReady({ ...withoutAudio, requiresSpeaking: true }, null), false)
  assert.equal(teachingAudioReady(withAudio, null), false)
  assert.equal(teachingAudioReady(withAudio, { ...readyAudio, externalId: 'another.audio' }), false)
  assert.equal(teachingAudioReady(withAudio, { ...readyAudio, status: 'CONTENT_REVIEW_REQUIRED' }), false)
  assert.equal(teachingAudioReady(withAudio, { ...readyAudio, assetStatus: 'PENDING' }), false)
  assert.equal(teachingAudioReady(withAudio, { ...readyAudio, cosKey: null }), false)
  assert.equal(teachingAudioReady(withAudio, { ...readyAudio, checksum: null }), false)
  assert.equal(teachingAudioReady(withAudio, { ...readyAudio, fileSize: 0 }), false)
  assert.equal(teachingAudioReady(withAudio, readyAudio), true)
})

test('batch route requires explicit confirmation and audits individually selected teaching IDs', () => {
  const source = readFileSync('app/api/admin/cantonese/review/batch/route.ts', 'utf8')
  assert.match(source, /type === 'teaching' && action === 'approve' && body\.confirmed !== true/)
  assert.match(source, /CONFIRMATION_REQUIRED/)
  assert.match(source, /const ids = \[\.\.\.new Set\(rawIds\.map\(safeReviewIdentifier\)/)
  assert.match(source, /teachingAudioReady\(current, audio\)/)
  assert.match(source, /tx\.cantoneseReviewLog\.create/)
  assert.doesNotMatch(source, /updateMany\(/)
})
