import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CantoneseSpeechError,
  normalizeSpeechRecording,
  parseAzurePronunciationResponse,
  recognizedAudioContainer,
} from '../lib/cantonese-speech'

function silentWav(durationMs: number) {
  const pcmBytes = Math.round(durationMs * 32)
  const wav = Buffer.alloc(44 + pcmBytes)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(16_000, 24)
  wav.writeUInt32LE(32_000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(pcmBytes, 40)
  return wav
}

test('recording format is identified by bytes, not extension or declared MIME', () => {
  assert.equal(recognizedAudioContainer(Buffer.from('RIFF\0\0\0\0WAVEfmt ')), 'wav')
  assert.equal(recognizedAudioContainer(Buffer.from('\0\0\0\0ftypisom')), 'm4a')
  assert.equal(recognizedAudioContainer(Buffer.from('OggS\0\0\0\0')), 'ogg')
  assert.equal(recognizedAudioContainer(Buffer.from('ID3\0\0\0\0')), 'mp3')
  assert.equal(recognizedAudioContainer(Buffer.from('not audio')), null)
})

test('recording is genuinely decoded and normalized to mono 16 kHz PCM with duration gates', async () => {
  const normalized = await normalizeSpeechRecording(silentWav(500))
  assert.equal(normalized.durationMs, 500)
  assert.equal(normalized.wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(normalized.wav.readUInt16LE(22), 1)
  assert.equal(normalized.wav.readUInt32LE(24), 16_000)
  await assert.rejects(normalizeSpeechRecording(silentWav(100)),
    (error) => error instanceof CantoneseSpeechError && error.code === 'RECORDING_TOO_SHORT')
  await assert.rejects(normalizeSpeechRecording(silentWav(20_500)),
    (error) => error instanceof CantoneseSpeechError && error.code === 'RECORDING_TOO_LONG')
})

test('Azure pronunciation mapping uses only returned scores and never invents a Cantonese tone score', () => {
  const result = parseAzurePronunciationResponse({
    RecognitionStatus: 'Success',
    NBest: [{ Display: '我今日想飲凍檸茶', Confidence: 0.8, PronScore: 82, AccuracyScore: 79,
      FluencyScore: 84, CompletenessScore: 90, Words: [{ Word: '我', AccuracyScore: 77, ErrorType: 'None' }] }],
  })
  assert.equal(result.overallScore, 82)
  assert.equal(result.pronunciationScore, 79)
  assert.equal(result.fluencyScore, 84)
  assert.equal(result.completenessScore, 90)
  assert.equal(result.toneScore, null)
  assert.equal(result.syllableResults, null)
  assert.deepEqual(result.wordResults, [{ text: '我', accuracyScore: 77, errorType: 'None' }])
})

test('missing provider metrics are null, not zero or synthesized from transcription confidence', () => {
  const result = parseAzurePronunciationResponse({ RecognitionStatus: 'Success', NBest: [{
    Display: '我今日', Confidence: 0.9, AccuracyScore: 61,
  }] })
  assert.equal(result.overallScore, null)
  assert.equal(result.fluencyScore, null)
  assert.equal(result.completenessScore, null)
  assert.equal(result.confidence, 0.9)
  assert.equal(result.toneScore, null)
  assert.throws(() => parseAzurePronunciationResponse({ RecognitionStatus: 'Success', NBest: [{ Display: '我今日', Confidence: 1 }] }),
    (error) => error instanceof CantoneseSpeechError && error.code === 'ASSESSMENT_UNAVAILABLE')
})
