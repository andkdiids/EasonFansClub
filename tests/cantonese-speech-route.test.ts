import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isCantonesePronunciationAssessmentEnabled } from '../lib/cantonese-speech-config'

const read = (path: string) => readFileSync(path, 'utf8')

test('pronunciation assessment is disabled by default and only enables explicitly', () => {
  assert.equal(isCantonesePronunciationAssessmentEnabled({}), false)
  assert.equal(isCantonesePronunciationAssessmentEnabled({ CANTONESE_PRONUNCIATION_ASSESSMENT_ENABLED: 'false' }), false)
  assert.equal(isCantonesePronunciationAssessmentEnabled({ CANTONESE_PRONUNCIATION_ASSESSMENT_ENABLED: 'true' }), true)
})

test('disabled speech assessment exits before parsing or creating an Azure provider', () => {
  const route = read('app/api/learning/cantonese/speech/assess/route.ts')
  assert.match(route, /isCantonesePronunciationAssessmentEnabled\(\)/)
  assert.match(route, /if \(!isCantonesePronunciationAssessmentEnabled\(\)\) return jsonError\('FEATURE_DISABLED', 404\)/)
  assert.ok(route.indexOf("jsonError('FEATURE_DISABLED', 404)") < route.indexOf("request.headers.get('content-type')"))
  assert.ok(route.indexOf("request.headers.get('content-type')") < route.indexOf('new AzureCantoneseSpeechAssessmentProvider()'))
})

test('speech API authorizes identity and derives the approved reference on Server', () => {
  const route = read('app/api/learning/cantonese/speech/assess/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /consumeRateLimit\(`/)
  assert.match(route, /where: \{ externalId: contentId \}/)
  assert.match(route, /content\.status !== 'APPROVED'/)
  assert.match(route, /!content\.requiresSpeaking/)
  assert.match(route, /referenceText: content\.displayText\.trim\(\)/)
  assert.doesNotMatch(route, /form\?\.get\('(?:expectedText|jyutping|correctAnswer)'\)/)
})

test('speech API validates actual bytes, stores no raw recording, and preserves unsupported scores as null', () => {
  const route = read('app/api/learning/cantonese/speech/assess/route.ts')
  const provider = read('lib/cantonese-speech.ts')
  assert.match(route, /recording\.size > MAX_UPLOAD_BYTES/)
  assert.match(route, /normalizeSpeechRecording\(input\)/)
  assert.match(provider, /recognizedAudioContainer\(input\)/)
  assert.match(route, /toneScore: null/)
  assert.match(route, /syllableResults: Prisma\.JsonNull/)
  assert.doesNotMatch(route, /recording(?:Bytes|Buffer|Audio)\s*:/)
  assert.doesNotMatch(provider, /console\.(?:log|warn|error)\(/)
})

test('approved course data and native audio endpoint do not leak pending assets', () => {
  const course = read('app/api/learning/cantonese/course/route.ts')
  const audio = read('app/api/learning/cantonese/audio/[audioId]/route.ts')
  assert.match(course, /status: 'APPROVED'/)
  assert.match(course, /assetStatus: 'READY'/)
  assert.match(course, /readyAudioIds\.has\(item\.audioId\)/)
  assert.match(audio, /asset\.status !== 'APPROVED'/)
  assert.match(audio, /asset\.assetStatus !== 'READY'/)
  assert.doesNotMatch(audio, /cosKey: asset\.cosKey/)
})

test('speaking review history is user-scoped and based only on real provider scores', () => {
  const route = read('app/api/learning/cantonese/speech/history/route.ts')
  assert.match(route, /requireRequestUser\(request\)/)
  assert.match(route, /userId: guard\.user\.id/)
  assert.match(route, /overallScore: \{ lt: 70 \}/)
  assert.match(route, /take: limit \+ 1/)
  assert.doesNotMatch(route, /recording|rawAudio|cosKey/)
})
