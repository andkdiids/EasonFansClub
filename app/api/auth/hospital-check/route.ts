import { NextResponse } from 'next/server'
import { EHospitalCheckError, getEHospitalCheckState, startEHospitalCheck } from '@/lib/ehospital-check'
import { consumeHospitalCheckStartRateLimit } from '@/lib/registration-rate-limit'
import { getClientIp, rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'
import { createUUID } from '@/lib/utils/uuid'
import { getRegistrationAvailabilityError, getRegistrationPolicy } from '@/lib/registration'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

function handleError(error: unknown, requestId = createUUID()) {
  if (error instanceof EHospitalCheckError) {
    return NextResponse.json({ message: error.message, code: error.code, requestId }, { status: error.status, headers: noStoreHeaders })
  }
  console.error('[auth.hospital-check]', { requestId, error })
  return NextResponse.json({ message: '体检服务暂时不可用，请稍后再试', code: 'EHOSPITAL_CHECK_FAILED', requestId }, { status: 500, headers: noStoreHeaders })
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const policy = await getRegistrationPolicy()
  const availabilityError = getRegistrationAvailabilityError(policy.registrationAvailability)
  if (availabilityError) return NextResponse.json({ message: availabilityError.message, code: availabilityError.code, ...availabilityError.meta }, { status: availabilityError.status, headers: noStoreHeaders })
  const startedAt = Date.now()
  const body = await request.json().catch(() => null)
  const suppliedRequestId = String(body?.requestId ?? '').trim()
  const requestId = suppliedRequestId.length >= 8 && suppliedRequestId.length <= 128 ? suppliedRequestId : createUUID()
  const clientIp = getClientIp(request)
  const rate = consumeHospitalCheckStartRateLimit(clientIp)
  if (rate.limited) {
    console.info('[auth.hospital-check] POST rate limited', { requestId, at: new Date().toISOString(), retryAfterSeconds: rate.retryAfterSeconds })
    return NextResponse.json({ message: '体检请求过于频繁，请稍后再试', code: 'EHOSPITAL_CHECK_RATE_LIMITED', requestId }, {
      status: 429,
      headers: { ...noStoreHeaders, 'Retry-After': String(rate.retryAfterSeconds) },
    })
  }
  console.info('[auth.hospital-check] POST started', { requestId, at: new Date().toISOString() })
  try {
    const registrationToken = String(body?.registrationToken ?? '').trim()
    if (!registrationToken) return NextResponse.json({ message: '注册验证凭证缺失', code: 'REGISTRATION_TOKEN_REQUIRED', requestId }, { status: 400, headers: noStoreHeaders })
    const state = await startEHospitalCheck({ draftTokenHash: hashToken(registrationToken), ip: clientIp, requestId })
    console.info('[auth.hospital-check] POST completed', { requestId, elapsedMs: Date.now() - startedAt, status: state.status, sessionId: state.sessionId })
    return NextResponse.json({ ...state, requestId }, { headers: noStoreHeaders })
  } catch (error) {
    return handleError(error, requestId)
  }
}

export async function GET(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const policy = await getRegistrationPolicy()
  const availabilityError = getRegistrationAvailabilityError(policy.registrationAvailability)
  if (availabilityError) return NextResponse.json({ message: availabilityError.message, code: availabilityError.code, ...availabilityError.meta }, { status: availabilityError.status, headers: noStoreHeaders })
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
