import { spawn } from 'node:child_process'
import { getFfmpegPath } from '@/lib/guess-song-audio'

export type SpeechFailureCode =
  | 'INVALID_AUDIO'
  | 'RECORDING_TOO_SHORT'
  | 'RECORDING_TOO_LONG'
  | 'ASSESSMENT_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMIT'

export class CantoneseSpeechError extends Error {
  constructor(public readonly code: SpeechFailureCode) {
    super(code)
    this.name = 'CantoneseSpeechError'
  }
}

export type CantonesePronunciationResult = {
  provider: 'AZURE_SPEECH'
  providerVersion: 'rest-v1-zh-HK'
  assessmentVersion: 'cantonese-v1'
  recognizedText: string | null
  overallScore: number | null
  pronunciationScore: number | null
  toneScore: null
  fluencyScore: number | null
  completenessScore: number | null
  confidence: number | null
  wordResults: Array<{ text: string; accuracyScore: number | null; errorType: string | null }> | null
  syllableResults: null
  feedback: null
}

export interface CantoneseSpeechAssessmentProvider {
  assess(input: { referenceText: string; wav: Buffer }): Promise<CantonesePronunciationResult>
}

const MAX_INPUT_BYTES = 3 * 1024 * 1024
const MIN_DURATION_MS = 400
const MAX_DURATION_MS = 20_000
const MAX_PCM_BYTES = 32_000 * 21

export function recognizedAudioContainer(input: Buffer): 'wav' | 'm4a' | 'mp3' | 'ogg' | null {
  if (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  if (input.length >= 12 && input.toString('ascii', 4, 8) === 'ftyp') return 'm4a'
  if (input.length >= 4 && input.toString('ascii', 0, 4) === 'OggS') return 'ogg'
  if (input.length >= 3 && input.toString('ascii', 0, 3) === 'ID3') return 'mp3'
  if (input.length >= 2 && input[0] === 0xff && (input[1] & 0xe0) === 0xe0) return 'mp3'
  return null
}

function wrapPcmAsWav(pcm: Buffer) {
  const wav = Buffer.alloc(44 + pcm.length)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8, 'ascii')
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20) // PCM
  wav.writeUInt16LE(1, 22) // mono
  wav.writeUInt32LE(16_000, 24)
  wav.writeUInt32LE(32_000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36, 'ascii')
  wav.writeUInt32LE(pcm.length, 40)
  pcm.copy(wav, 44)
  return wav
}

/** Decode rather than trusting the filename or MIME type; never writes a user's recording to disk. */
export async function normalizeSpeechRecording(input: Buffer): Promise<{ wav: Buffer; durationMs: number }> {
  if (!input.length || input.length > MAX_INPUT_BYTES || !recognizedAudioContainer(input)) {
    throw new CantoneseSpeechError('INVALID_AUDIO')
  }
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(getFfmpegPath(), [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-ac', '1', '-ar', '16000',
      '-acodec', 'pcm_s16le', '-f', 's16le', 'pipe:1',
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (error?: CantoneseSpeechError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(Buffer.concat(chunks))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new CantoneseSpeechError('PROVIDER_TIMEOUT'))
    }, 15_000)
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_PCM_BYTES) {
        child.kill('SIGKILL')
        finish(new CantoneseSpeechError('RECORDING_TOO_LONG'))
        return
      }
      chunks.push(chunk)
    })
    child.once('error', () => finish(new CantoneseSpeechError('ASSESSMENT_UNAVAILABLE')))
    child.once('close', (code) => finish(code === 0 ? undefined : new CantoneseSpeechError('INVALID_AUDIO')))
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })
  const durationMs = Math.round(pcm.length / 32)
  if (durationMs < MIN_DURATION_MS) throw new CantoneseSpeechError('RECORDING_TOO_SHORT')
  if (durationMs > MAX_DURATION_MS) throw new CantoneseSpeechError('RECORDING_TOO_LONG')
  return { wav: wrapPcmAsWav(pcm), durationMs }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function score(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/** Only map metrics the provider actually returned. In particular, no Cantonese tone score is inferred. */
export function parseAzurePronunciationResponse(payload: unknown): CantonesePronunciationResult {
  const top = record(payload)
  const best = Array.isArray(top?.NBest) ? record(top.NBest[0]) : null
  if (top?.RecognitionStatus !== 'Success' || !best) throw new CantoneseSpeechError('ASSESSMENT_UNAVAILABLE')
  const overallScore = score(best.PronScore)
  const pronunciationScore = score(best.AccuracyScore)
  const fluencyScore = score(best.FluencyScore)
  const completenessScore = score(best.CompletenessScore)
  if ([overallScore, pronunciationScore, fluencyScore, completenessScore].every((item) => item === null)) {
    throw new CantoneseSpeechError('ASSESSMENT_UNAVAILABLE')
  }
  const words = Array.isArray(best.Words) ? best.Words.flatMap((entry) => {
    const word = record(entry)
    if (!word || typeof word.Word !== 'string') return []
    return [{
      text: word.Word.slice(0, 100),
      accuracyScore: score(word.AccuracyScore),
      errorType: typeof word.ErrorType === 'string' ? word.ErrorType.slice(0, 50) : null,
    }]
  }).slice(0, 100) : null
  return {
    provider: 'AZURE_SPEECH', providerVersion: 'rest-v1-zh-HK', assessmentVersion: 'cantonese-v1',
    recognizedText: typeof best.Display === 'string' ? best.Display.slice(0, 2_000) : typeof top.DisplayText === 'string' ? top.DisplayText.slice(0, 2_000) : null,
    overallScore, pronunciationScore, toneScore: null, fluencyScore, completenessScore,
    confidence: typeof best.Confidence === 'number' && best.Confidence >= 0 && best.Confidence <= 1 ? best.Confidence : null,
    wordResults: words, syllableResults: null, feedback: null,
  }
}

export class AzureCantoneseSpeechAssessmentProvider implements CantoneseSpeechAssessmentProvider {
  async assess({ referenceText, wav }: { referenceText: string; wav: Buffer }) {
    const resource = process.env.AZURE_SPEECH_RESOURCE_NAME?.trim()
    const key = process.env.AZURE_SPEECH_KEY?.trim()
    if (!resource || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/i.test(resource) || !key) {
      throw new CantoneseSpeechError('ASSESSMENT_UNAVAILABLE')
    }
    const url = `https://${resource}.cognitiveservices.azure.com/stt/speech/recognition/conversation/cognitiveservices/v1?language=zh-HK&format=detailed`
    const params = Buffer.from(JSON.stringify({
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Word',
      Dimension: 'Comprehensive',
      EnableMiscue: 'True',
    }), 'utf8').toString('base64')
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          'Ocp-Apim-Subscription-Key': key,
          'Pronunciation-Assessment': params,
        },
        body: new Uint8Array(wav),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (error) {
      throw new CantoneseSpeechError(error instanceof Error && error.name === 'TimeoutError' ? 'PROVIDER_TIMEOUT' : 'ASSESSMENT_UNAVAILABLE')
    }
    if (response.status === 429) throw new CantoneseSpeechError('PROVIDER_RATE_LIMIT')
    if (!response.ok) throw new CantoneseSpeechError('ASSESSMENT_UNAVAILABLE')
    const payload = await response.json().catch(() => null)
    return parseAzurePronunciationResponse(payload)
  }
}
