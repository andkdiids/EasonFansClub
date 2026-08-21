import { NextResponse } from 'next/server'
import { isAuthServiceUnavailableError } from '@/lib/auth'
import { ClinicServiceError } from '@/lib/clinic-service'

export const clinicPublicHeaders = {
  'Cache-Control': 'no-store',
  Vary: 'Cookie',
}

type ClinicErrorContext = {
  action?: string
  recordId?: string
  consultationId?: string
  userId?: string
  anonymous?: boolean
  contentLength?: number
}

function getPrismaCode(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

export function clinicErrorResponse(error: unknown, context: ClinicErrorContext = {}) {
  if (isAuthServiceUnavailableError(error)) {
    return NextResponse.json({ ok: false, code: 'AUTH_SERVICE_UNAVAILABLE', message: '登录服务暂时不可用，请稍后再试。' }, { status: 503, headers: clinicPublicHeaders })
  }
  if (error instanceof ClinicServiceError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, {
      status: error.status,
      headers: error.status === 429 ? { ...clinicPublicHeaders, 'Retry-After': '60' } : clinicPublicHeaders,
    })
  }
  console.error(`[${context.action || 'clinic.api'}]`, {
    ...(context.recordId ? { recordId: context.recordId } : {}),
    ...(context.consultationId ? { consultationId: context.consultationId } : {}),
    ...(context.userId ? { userId: context.userId } : {}),
    ...(typeof context.anonymous === 'boolean' ? { anonymous: context.anonymous } : {}),
    ...(typeof context.contentLength === 'number' ? { contentLength: context.contentLength } : {}),
    errorName: error instanceof Error ? error.name : 'unknown',
    prismaCode: getPrismaCode(error),
  })
  return NextResponse.json({ ok: false, code: 'CLINIC_UNAVAILABLE', message: '门诊系统暂时有点忙，请稍后再试。' }, { status: 500, headers: clinicPublicHeaders })
}

export function clinicOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: clinicPublicHeaders })
}
