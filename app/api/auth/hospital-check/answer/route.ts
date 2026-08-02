import { NextResponse } from 'next/server'
import { answerEHospitalCheck, EHospitalCheckError } from '@/lib/ehospital-check'
import { getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  try {
    const body = await request.json().catch(() => null)
    const registrationToken = String(body?.registrationToken ?? '').trim()
    const sessionId = String(body?.sessionId ?? '').trim()
    const questionId = String(body?.questionId ?? '').trim()
    const optionKey = String(body?.optionKey ?? '').trim()
    if (!registrationToken || !sessionId || !questionId || !optionKey) {
      return NextResponse.json({ message: '答题参数不完整', code: 'ANSWER_FIELDS_REQUIRED' }, { status: 400, headers: noStoreHeaders })
    }
    const state = await answerEHospitalCheck({
      draftTokenHash: hashToken(registrationToken),
      sessionId,
      questionId,
      optionKey,
      ip: getClientIp(request),
    })
    return NextResponse.json(state, { headers: noStoreHeaders })
  } catch (error) {
    if (error instanceof EHospitalCheckError) {
      return NextResponse.json({ message: error.message, code: error.code }, { status: error.status, headers: noStoreHeaders })
    }
    console.error('[auth.hospital-check.answer]', error)
    return NextResponse.json({ message: '提交答案失败，请稍后再试', code: 'ANSWER_FAILED' }, { status: 500, headers: noStoreHeaders })
  }
}
