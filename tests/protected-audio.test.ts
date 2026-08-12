import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseAudioRangeHeader } from '../lib/protected-audio'

const read = (path: string) => readFileSync(path, 'utf8')

test('protected audio parses normal, open-ended, and suffix byte ranges', () => {
  assert.deepEqual(parseAudioRangeHeader('bytes=0-1023', 4096), { start: 0, end: 1023 })
  assert.deepEqual(parseAudioRangeHeader('bytes=1000-', 4096), { start: 1000, end: 4095 })
  assert.deepEqual(parseAudioRangeHeader('bytes=-512', 4096), { start: 3584, end: 4095 })
  assert.deepEqual(parseAudioRangeHeader('bytes=0-99999', 4096), { start: 0, end: 4095 })
  assert.equal(parseAudioRangeHeader(null, 4096), null)
})

test('protected audio rejects invalid or multi-range requests', () => {
  assert.deepEqual(parseAudioRangeHeader('bytes=4096-4097', 4096), { invalid: true })
  assert.deepEqual(parseAudioRangeHeader('bytes=100-99', 4096), { invalid: true })
  assert.deepEqual(parseAudioRangeHeader('bytes=0-1,4-5', 4096), { invalid: true })
  assert.deepEqual(parseAudioRangeHeader('bytes=-0', 4096), { invalid: true })
})

test('private media routes authenticate and stream COS objects without exposing signed URLs', () => {
  const fullRoute = read('app/api/music/songs/[songId]/playback/audio/route.ts')
  const guessRoute = read('app/api/entertainment/guess-song/sessions/[sessionId]/audio/route.ts')
  const hospitalRoute = read('app/api/auth/hospital-check/audio/route.ts')
  const stream = read('lib/protected-audio.ts')

  assert.match(fullRoute, /canPlayFullMusic/)
  assert.match(fullRoute, /streamProtectedGuessSongAudio/)
  assert.match(guessRoute, /requireUser\(\)/)
  assert.match(guessRoute, /getGuessSongPlaybackSource/)
  assert.match(hospitalRoute, /getEHospitalCheckAudioSource/)
  assert.match(stream, /getGuessSongObjectMetadata/)
  assert.match(stream, /openGuessSongObjectStream/)
  assert.match(stream, /status = range \? 206 : 200/)
  assert.match(stream, /Content-Range/)
  assert.match(stream, /Readable\.toWeb/)
  assert.doesNotMatch(fullRoute, /createGuessSongSignedUrl|signedUrl/)
  assert.doesNotMatch(guessRoute, /createGuessSongSignedUrl|signedUrl/)
})

