import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { consumeRateLimit, requireRequestUser } from '@/lib/security'
import {
  AzureCantoneseSpeechAssessmentProvider,
  CantoneseSpeechError,
  normalizeSpeechRecording,
} from '@/lib/cantonese-speech'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024
const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024
const ASSESSMENT_MODES = new Set(['READ_ALOUD', 'SHADOWING'])

function jsonError(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status, headers: NO_STORE })
}

function statusFor(code: string) {
  if (code === 'RECORDING_TOO_LONG') return 413
  if (code === 'PROVIDER_RATE_LIMIT') return 429
  if (code === 'PROVIDER_TIMEOUT') return 504
  if (code === 'ASSESSMENT_UNAVAILABLE') return 503
  return 400
}

async function boundedFormData(request: Request, contentType: string): Promise<FormData | null> {
  if (!request.body) return null
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_MULTIPART_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new CantoneseSpeechError('RECORDING_TOO_LONG')
      }
      parts.push(value)
    }
    const bounded = new Request(request.url, { method: 'POST', headers: { 'Content-Type': contentType },
      body: Buffer.concat(parts.map((part) => Buffer.from(part)), length) })
    return await bounded.formData()
  } catch (error) {
    if (error instanceof CantoneseSpeechError) throw error
    return null
  }
}

export async function POST(request: Request) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) return jsonError('INVALID_AUDIO', 415)
  const declaredSize = Number(request.headers.get('content-length') || 0)
  if (declaredSize > MAX_MULTIPART_BYTES) return jsonError('RECORDING_TOO_LONG', 413)
  const limit = await consumeRateLimit(`cantonese-speech:${guard.user.id}`, 'assess', 10, 60)
  if (limit.limited) return jsonError('PROVIDER_RATE_LIMIT', 429)

  let form: FormData | null
  try { form = await boundedFormData(request, contentType) }
  catch (error) {
    return jsonError(error instanceof CantoneseSpeechError ? error.code : 'INVALID_AUDIO', 413)
  }
  const contentId = form?.get('contentId')
  const assessmentMode = form?.get('assessmentMode')
  const recording = form?.get('recording')
  if (typeof contentId !== 'string' || !/^[a-zA-Z0-9._:-]{1,191}$/.test(contentId) ||
    typeof assessmentMode !== 'string' || !ASSESSMENT_MODES.has(assessmentMode) ||
    !(recording instanceof File) || recording.size === 0 || recording.size > MAX_UPLOAD_BYTES ||
    !/^audio\/(?:mp4|m4a|x-m4a|mpeg|mp3|wav|x-wav|ogg|octet-stream)$/i.test(recording.type)) {
    return jsonError('INVALID_AUDIO', 400)
  }

  const content = await prisma.cantoneseLessonContent.findUnique({
    where: { externalId: contentId },
    select: { externalId: true, status: true, requiresSpeaking: true, displayText: true },
  })
  if (!content || content.status !== 'APPROVED' || !content.requiresSpeaking || !content.displayText?.trim()) {
    return jsonError('UNSUPPORTED_CONTENT', 404)
  }

  try {
    const input = Buffer.from(await recording.arrayBuffer())
    const { wav, durationMs } = await normalizeSpeechRecording(input)
    const result = await new AzureCantoneseSpeechAssessmentProvider().assess({ referenceText: content.displayText.trim(), wav })
    const saved = await prisma.cantonesePronunciationAssessment.create({
      data: {
        userId: guard.user.id,
        contentId: content.externalId,
        assessmentMode,
        provider: result.provider,
        providerVersion: result.providerVersion,
        assessmentVersion: result.assessmentVersion,
        expectedText: content.displayText.trim(),
        recognizedText: result.recognizedText,
        overallScore: result.overallScore,
        pronunciationScore: result.pronunciationScore,
        toneScore: null,
        fluencyScore: result.fluencyScore,
        completenessScore: result.completenessScore,
        confidence: result.confidence,
        wordResults: result.wordResults === null ? Prisma.JsonNull : result.wordResults,
        syllableResults: Prisma.JsonNull,
        feedback: Prisma.JsonNull,
        recordingDurationMs: durationMs,
      },
      select: { id: true, createdAt: true },
    })
    return NextResponse.json({
      id: saved.id,
      createdAt: saved.createdAt,
      contentId: content.externalId,
      expectedText: content.displayText.trim(),
      ...result,
    }, { headers: NO_STORE })
  } catch (error) {
    const code = error instanceof CantoneseSpeechError ? error.code : 'ASSESSMENT_UNAVAILABLE'
    return jsonError(code, statusFor(code))
  }
}
