import { EHospitalCheckError, getEHospitalCheckAudioSource } from '@/lib/ehospital-check'
import { streamProtectedGuessSongAudio } from '@/lib/protected-audio'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function handleError(error: unknown) {
  if (error instanceof EHospitalCheckError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status })
  }
  console.error('[auth.hospital-check.audio]', error)
  return NextResponse.json({ ok: false, code: 'REGISTER_AUDIO_FAILED', message: '体检音频暂时不可用，请稍后重试' }, { status: 502 })
}

async function handle(request: Request) {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')?.trim() || ''
  const questionId = url.searchParams.get('questionId')?.trim() || ''
  if (!sessionId || !questionId) {
    return NextResponse.json({ ok: false, code: 'AUDIO_SESSION_REQUIRED', message: '体检音频参数缺失' }, { status: 400 })
  }
  try {
    const source = await getEHospitalCheckAudioSource({ sessionId, questionId })
    return streamProtectedGuessSongAudio(request, source.storagePath)
  } catch (error) {
    return handleError(error)
  }
}

export async function GET(request: Request) {
  return handle(request)
}

export async function HEAD(request: Request) {
  return handle(request)
}
