import { NextResponse } from 'next/server'
import { ClinicServiceError } from '@/lib/clinic-service'

export const clinicPublicHeaders = {
  'Cache-Control': 'no-store',
  Vary: 'Cookie',
}

export function clinicErrorResponse(error: unknown) {
  if (error instanceof ClinicServiceError) {
    return NextResponse.json({ ok: false, code: error.code, message: error.message }, { status: error.status, headers: clinicPublicHeaders })
  }
  console.error('[clinic.api]', { error: error instanceof Error ? error.name : 'unknown' })
  return NextResponse.json({ ok: false, code: 'CLINIC_UNAVAILABLE', message: '门诊系统暂时有点忙，请稍后再试。' }, { status: 503, headers: clinicPublicHeaders })
}

export function clinicOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: clinicPublicHeaders })
}
