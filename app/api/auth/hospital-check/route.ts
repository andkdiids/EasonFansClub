import { NextResponse } from 'next/server'
import { EHospitalCheckError, getEHospitalCheckState, startEHospitalCheck } from '@/lib/ehospital-check'
import { getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function handleError(error: unknown) {
  if (error instanceof EHospitalCheckError) {
    return NextResponse.json({ message: error.message, code: error.code }, { status: error.status, headers: noStoreHeaders })
  }
  console.error('[auth.hospital-check]', error)
  return NextResponse.json({ message: '体检服务暂时不可用，请稍后再试', code: 'EHOSPITAL_CHECK_FAILED' }, { status: 500, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const startedAt = Date.now()
  console.info('[auth.hospital-check] POST started', { at: new Date().toISOString() })
  try {
    const body = await request.json().catch(() => null)
    const registrationToken = String(body?.registrationToken ?? '').trim()
    if (!registrationToken) return NextResponse.json({ message: '注册验证凭证缺失', code: 'REGISTRATION_TOKEN_REQUIRED' }, { status: 400, headers: noStoreHeaders })
    const state = await startEHospitalCheck({ draftTokenHash: hashToken(registrationToken), ip: getClientIp(request) })
    console.info('[auth.hospital-check] POST completed', { elapsedMs: Date.now() - startedAt, status: state.status, sessionId: state.sessionId })
    return NextResponse.json(state, { headers: noStoreHeaders })
  } catch (error) {
    return handleError(error)
  }
}

export async function GET(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  try {
    const url = new URL(request.url)
    const registrationToken = url.searchParams.get('registrationToken')?.trim() || ''
    const sessionId = url.searchParams.get('sessionId')?.trim() || ''
    if (!registrationToken || !sessionId) return NextResponse.json({ message: '体检场次凭证缺失', code: 'SESSION_REQUIRED' }, { status: 400, headers: noStoreHeaders })
    const state = await getEHospitalCheckState({ draftTokenHash: hashToken(registrationToken), sessionId })
    return NextResponse.json(state, { headers: noStoreHeaders })
  } catch (error) {
    return handleError(error)
  }
}
