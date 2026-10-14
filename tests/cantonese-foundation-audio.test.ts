import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import {
  FOUNDATION_AUDIO_TEXT,
  FoundationAudioUnavailable,
  foundationAudioObjectKey,
  isFoundationAudioId,
  readFoundationAudioConfig,
  resolveFoundationAudioUrl,
  synthesizeFoundationAudio,
  type FoundationAudioStorage,
} from '../lib/cantonese-foundation-audio'

const config = readFoundationAudioConfig({
  TENCENT_TTS_SECRET_ID: 'test-id', TENCENT_TTS_SECRET_KEY: 'test-secret',
  TENCENT_TTS_REGION: 'ap-guangzhou', TENCENT_TTS_VOICE_TYPE: '101019',
  TENCENT_TTS_SPEED: '0', TENCENT_TTS_SAMPLE_RATE: '16000', TENCENT_TTS_CODEC: 'mp3',
  TENCENT_COS_SECRET_ID: 'cos-id', TENCENT_COS_SECRET_KEY: 'cos-secret',
  TENCENT_COS_BUCKET: 'test-bucket', TENCENT_COS_REGION: 'ap-guangzhou',
})

function storage(initiallyPresent = false) {
  let present = initiallyPresent
  const calls = { head: 0, upload: 0, sign: 0 }
  const adapter: FoundationAudioStorage = {
    async exists() { calls.head++; return present },
    async upload(_key, audio) { assert.ok(audio.length > 0); calls.upload++; present = true },
    signedUrl(key) { calls.sign++; return `https://cos.example/${key}?signed=yes` },
  }
  return { adapter, calls }
}

test('only ten static Foundation IDs are accepted; unknown input never reaches TTS', async () => {
  assert.equal(Object.keys(FOUNDATION_AUDIO_TEXT).length, 10)
  assert.ok(isFoundationAudioId('foundation.tone.faan1'))
  assert.ok(isFoundationAudioId('foundation.phrase'))
  assert.equal(isFoundationAudioId('freeform.你好'), false)
  assert.equal(await resolveFoundationAudioUrl('freeform.你好', {
    config,
    storage: { exists: async () => { throw Error('should not run') }, upload: async () => {}, signedUrl: () => '' },
  }), null)
})

test('configured voice must be Cantonese and cache key changes with synthesis settings', () => {
  assert.throws(() => readFoundationAudioConfig({ ...process.env, TENCENT_TTS_VOICE_TYPE: '1001' }),
    (error: unknown) => error instanceof FoundationAudioUnavailable && error.code === 'CONFIG')
  const first = foundationAudioObjectKey('番', config)
  assert.match(first, /^learning\/cantonese\/foundation\/v1\/[a-f0-9]{64}\.mp3$/)
  assert.equal(first, foundationAudioObjectKey('番', config))
  assert.notEqual(first, foundationAudioObjectKey('茄', config))
  assert.notEqual(first, foundationAudioObjectKey('番', { ...config, speed: 1 }))
})

test('COS hit returns a signed URL without synthesizing', async () => {
  const { adapter, calls } = storage(true)
  const url = await resolveFoundationAudioUrl('foundation.tone.faan1', {
    config, storage: adapter, synthesize: async () => { throw Error('should not synthesize') },
  })
  assert.match(url || '', /signed=yes/)
  assert.equal(calls.head, 1)
  assert.equal(calls.upload, 0)
  assert.equal(calls.sign, 1)
})

test('cache miss synthesizes once and uploads MP3; parallel requests share the in-flight work', async () => {
  const { adapter, calls } = storage()
  let syntheses = 0
  const synthesize = async (text: string) => {
    assert.equal(text, '番')
    syntheses++
    await new Promise((resolve) => setTimeout(resolve, 20))
    return Buffer.from('ID3\u0004\u0000')
  }
  const urls = await Promise.all(Array.from({ length: 4 }, () => resolveFoundationAudioUrl('foundation.tone.faan1', {
    config, storage: adapter, synthesize,
  })))
  assert.equal(new Set(urls).size, 1)
  assert.equal(syntheses, 1)
  assert.equal(calls.upload, 1)
})

test('failed synthesis never publishes a URL and can be retried', async () => {
  const { adapter, calls } = storage()
  await assert.rejects(() => resolveFoundationAudioUrl('foundation.tone.ke2', {
    config, storage: adapter, synthesize: async () => { throw new FoundationAudioUnavailable('TTS') },
  }), /FOUNDATION_AUDIO_TTS/)
  assert.equal(calls.upload, 0)
  assert.equal(calls.sign, 0)
  const url = await resolveFoundationAudioUrl('foundation.tone.ke2', {
    config, storage: adapter, synthesize: async () => Buffer.from('ID3\u0004\u0000'),
  })
  assert.match(url || '', /signed=yes/)
})

test('Tencent request uses server-side signed TextToVoice MP3 and rejects malformed audio', async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    assert.equal(init?.method, 'POST')
    const headers = new Headers(init?.headers)
    assert.match(headers.get('authorization') || '', /^TC3-HMAC-SHA256 Credential=test-id\//)
    assert.equal(headers.get('x-tc-action'), 'TextToVoice')
    assert.equal(headers.get('x-tc-version'), '2019-08-23')
    assert.equal(headers.get('x-tc-region'), 'ap-guangzhou')
    const body = JSON.parse(String(init?.body)) as { Text: string; Codec: string; VoiceType: number }
    assert.deepEqual([body.Text, body.Codec, body.VoiceType], ['番', 'mp3', 101019])
    return Response.json({ Response: { Audio: Buffer.from('ID3\u0004\u0000').toString('base64') } })
  }
  assert.equal((await synthesizeFoundationAudio('番', config, fetcher)).subarray(0, 3).toString(), 'ID3')
  await assert.rejects(() => synthesizeFoundationAudio('番', config,
    async () => Response.json({ Response: { Audio: 'not-an-mp3' } })), /FOUNDATION_AUDIO_TTS/)
})

test('Bearer GET reaches only exact learning audio path; anonymous and POST remain blocked', async () => {
  process.env.JWT_SECRET = 'foundation-middleware-test-secret'
  const { middleware } = await import('../middleware')
  const url = 'https://ecfc.fans/api/learning/cantonese/audio/foundation.tone.faan1'
  const bearer = await middleware(new NextRequest(url, { headers: { authorization: 'Bearer test-token' } }))
  assert.equal(bearer.status, 200)
  const anonymous = await middleware(new NextRequest(url))
  assert.equal(anonymous.status, 401)
  const post = await middleware(new NextRequest(url, { method: 'POST', headers: { authorization: 'Bearer test-token' } }))
  assert.equal(post.status, 401)
  const sibling = await middleware(new NextRequest('https://ecfc.fans/api/learning/cantonese/other/x',
    { headers: { authorization: 'Bearer test-token' } }))
  assert.equal(sibling.status, 401)
})
