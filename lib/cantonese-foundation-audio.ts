import { createHash, createHmac, randomUUID } from 'node:crypto'
import COS from 'cos-nodejs-sdk-v5'

/** Only approved course material can trigger synthesis. Never accept arbitrary text. */
export const FOUNDATION_AUDIO_TEXT = {
  'foundation.tone.faan1': '番',
  'foundation.tone.ke2': '茄',
  'foundation.tone.zoeng3': '酱',
  'foundation.tone.ngau4': '牛',
  'foundation.tone.naam5': '腩',
  'foundation.tone.min6': '面',
  'foundation.tone.bat1': '不',
  'foundation.tone.hek3': '吃',
  'foundation.tone.laat6': '辣',
  'foundation.phrase': '番茄酱牛腩面不吃辣',
} as const

export type FoundationAudioId = keyof typeof FOUNDATION_AUDIO_TEXT

export function isFoundationAudioId(value: string): value is FoundationAudioId {
  return Object.hasOwn(FOUNDATION_AUDIO_TEXT, value)
}

export type CantoneseAudioConfig = {
  secretId: string
  secretKey: string
  region: string
  voiceType: number
  speed: number
  sampleRate: number
  codec: 'mp3'
  bucket: string
  cosRegion: string
  cosSecretId: string
  cosSecretKey: string
}

export class FoundationAudioUnavailable extends Error {
  constructor(readonly code: 'CONFIG' | 'TTS' | 'COS') {
    super(`FOUNDATION_AUDIO_${code}`)
    this.name = 'FoundationAudioUnavailable'
  }
}

export function readFoundationAudioConfig(env: Record<string, string | undefined> = process.env): CantoneseAudioConfig {
  const secretId = env.TENCENT_TTS_SECRET_ID?.trim() || ''
  const secretKey = env.TENCENT_TTS_SECRET_KEY?.trim() || ''
  const region = env.TENCENT_TTS_REGION?.trim() || ''
  const voiceType = Number(env.TENCENT_TTS_VOICE_TYPE)
  const speed = Number(env.TENCENT_TTS_SPEED ?? 0)
  const sampleRate = Number(env.TENCENT_TTS_SAMPLE_RATE ?? 16000)
  const codec = env.TENCENT_TTS_CODEC?.trim().toLowerCase() || 'mp3'
  const bucket = env.TENCENT_COS_BUCKET?.trim() || env.COS_BUCKET?.trim() || ''
  const cosRegion = env.TENCENT_COS_REGION?.trim() || env.COS_REGION?.trim() || ''
  const cosSecretId = env.TENCENT_COS_SECRET_ID?.trim() || env.COS_SECRET_ID?.trim() || ''
  const cosSecretKey = env.TENCENT_COS_SECRET_KEY?.trim() || env.COS_SECRET_KEY?.trim() || ''
  // 101019 is the Cantonese voice in Tencent's current TextToVoice voice list.
  // Fail closed rather than silently teaching Mandarin with a different voice.
  if (!secretId || !secretKey || !region || voiceType !== 101019
    || !Number.isFinite(speed) || speed < -2 || speed > 6
    || ![8000, 16000].includes(sampleRate) || codec !== 'mp3'
    || !bucket || !cosRegion || !cosSecretId || !cosSecretKey) {
    throw new FoundationAudioUnavailable('CONFIG')
  }
  return {
    secretId, secretKey, region, voiceType, speed, sampleRate, codec,
    bucket, cosRegion, cosSecretId, cosSecretKey,
  }
}

export function foundationAudioObjectKey(text: string, config: Pick<CantoneseAudioConfig, 'voiceType' | 'speed' | 'sampleRate' | 'codec'>) {
  const settings = JSON.stringify({ version: 1, language: 'yue', text,
    voiceType: config.voiceType, speed: config.speed, sampleRate: config.sampleRate, codec: config.codec })
  return `learning/cantonese/foundation/v1/${createHash('sha256').update(settings).digest('hex')}.mp3`
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmac(key: string | Buffer, value: string) {
  return createHmac('sha256', key).update(value, 'utf8').digest()
}

/** Tencent Cloud API 3.0 signing; credentials never leave this server process. */
export function signTencentTtsRequest(payload: string, config: Pick<CantoneseAudioConfig, 'secretId' | 'secretKey'>, timestamp: number) {
  const host = 'tts.tencentcloudapi.com'
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalRequest = ['POST', '/', '', 'content-type:application/json; charset=utf-8', `host:${host}`, '',
    'content-type;host', sha256(payload)].join('\n')
  const scope = `${date}/tts/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(`TC3${config.secretKey}`, date), 'tts'), 'tc3_request')
  const signature = createHmac('sha256', signingKey).update(stringToSign, 'utf8').digest('hex')
  return `TC3-HMAC-SHA256 Credential=${config.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`
}

export async function synthesizeFoundationAudio(text: string, config: CantoneseAudioConfig, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const payload = JSON.stringify({ Text: text, SessionId: randomUUID(), VoiceType: config.voiceType,
    Speed: config.speed, SampleRate: config.sampleRate, Codec: config.codec, PrimaryLanguage: 1 })
  const timestamp = Math.floor(Date.now() / 1000)
  let response: Response
  try {
    response = await fetcher('https://tts.tencentcloudapi.com/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: signTencentTtsRequest(payload, config, timestamp),
        'X-TC-Action': 'TextToVoice',
        'X-TC-Version': '2019-08-23',
        'X-TC-Region': config.region,
        'X-TC-Timestamp': String(timestamp),
      },
      body: payload,
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    if (!response.ok) throw new FoundationAudioUnavailable('TTS')
    const data = await response.json() as { Response?: { Audio?: unknown; Error?: { Code?: string } } }
    const encoded = data.Response?.Audio
    if (data.Response?.Error || typeof encoded !== 'string' || encoded.length > 4_000_000
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new FoundationAudioUnavailable('TTS')
    }
    const audio = Buffer.from(encoded, 'base64')
    const hasId3 = audio.subarray(0, 3).toString('ascii') === 'ID3'
    const hasFrameSync = audio.length >= 2 && audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0
    if (audio.length < 4 || (!hasId3 && !hasFrameSync)) throw new FoundationAudioUnavailable('TTS')
    return audio
  } catch {
    throw new FoundationAudioUnavailable('TTS')
  }
}

export type FoundationAudioStorage = {
  exists(key: string): Promise<boolean>
  read?(key: string): Promise<Buffer>
  upload(key: string, audio: Buffer): Promise<void>
  signedUrl(key: string): string
  metadata?(key: string): Promise<{ fileSize: number | null }>
}

export function createFoundationAudioStorage(config: CantoneseAudioConfig): FoundationAudioStorage {
  const cos = new COS({ SecretId: config.cosSecretId, SecretKey: config.cosSecretKey })
  const base = (key: string) => ({ Bucket: config.bucket, Region: config.cosRegion, Key: key })
  return {
    async exists(key) {
      try {
        await cos.headObject(base(key))
        return true
      } catch (error) {
        const detail = error as { statusCode?: number; code?: string }
        if (detail.statusCode === 404 || detail.code === 'NoSuchKey' || detail.code === 'NotFound') return false
        throw new FoundationAudioUnavailable('COS')
      }
    },
    async upload(key, audio) {
      try {
        await cos.putObject({ ...base(key), Body: audio, ContentLength: audio.length,
          ContentType: 'audio/mpeg', CacheControl: 'private, max-age=31536000, immutable' })
      } catch {
        throw new FoundationAudioUnavailable('COS')
      }
    },
    async read(key) {
      try {
        const result = await cos.getObject(base(key)) as { Body?: Buffer | string }
        const body = result.Body
        if (typeof body === 'string') return Buffer.from(body, 'binary')
        if (Buffer.isBuffer(body)) return body
        throw new FoundationAudioUnavailable('COS')
      } catch {
        throw new FoundationAudioUnavailable('COS')
      }
    },
    async metadata(key) {
      try {
        const result = await cos.headObject(base(key)) as { headers?: Record<string, string>; ContentLength?: number | string }
        const raw = result.ContentLength ?? result.headers?.['content-length'] ?? result.headers?.['Content-Length']
        const fileSize = Number(raw)
        return { fileSize: Number.isSafeInteger(fileSize) && fileSize >= 0 ? fileSize : null }
      } catch {
        throw new FoundationAudioUnavailable('COS')
      }
    },
    signedUrl(key) {
      try {
        return cos.getObjectUrl({ ...base(key), Sign: true, Method: 'GET', Protocol: 'https:', Expires: 300 })
      } catch {
        throw new FoundationAudioUnavailable('COS')
      }
    },
  }
}

const inFlight = new Map<string, Promise<void>>()

export async function resolveFoundationAudioUrl(audioId: string, options: {
  config?: CantoneseAudioConfig
  storage?: FoundationAudioStorage
  synthesize?: (text: string, config: CantoneseAudioConfig) => Promise<Buffer>
} = {}): Promise<string | null> {
  if (!isFoundationAudioId(audioId)) return null
  const config = options.config ?? readFoundationAudioConfig()
  const storage = options.storage ?? createFoundationAudioStorage(config)
  const text = FOUNDATION_AUDIO_TEXT[audioId]
  const key = foundationAudioObjectKey(text, config)
  try {
    if (await storage.exists(key)) return storage.signedUrl(key)
    let pending = inFlight.get(key)
    if (!pending) {
      pending = (async () => {
        // Another request may have filled COS between the first HEAD and this lock.
        if (await storage.exists(key)) return
        const audio = await (options.synthesize ?? synthesizeFoundationAudio)(text, config)
        await storage.upload(key, audio)
      })()
      inFlight.set(key, pending)
      void pending.finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key) }).catch(() => {})
    }
    await pending
    return storage.signedUrl(key)
  } catch (error) {
    if (error instanceof FoundationAudioUnavailable) throw error
    throw new FoundationAudioUnavailable('COS')
  }
}
