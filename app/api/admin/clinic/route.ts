import { NextResponse } from 'next/server'
import { clinicErrorResponse, clinicOk, clinicPublicHeaders } from '@/lib/clinic-api'
import { handleClinicReport, listClinicAdminData, updateClinicAdminContent, type ClinicAdminTab } from '@/lib/clinic-service'
import { requireAdmin } from '@/lib/security'

const tabs = new Set<ClinicAdminTab>(['records', 'reports', 'consultations'])
const statuses = new Set(['ACTIVE', 'HIDDEN', 'DELETED', 'REMOVED'])
const reportStatuses = new Set(['PENDING', 'RESOLVED', 'REJECTED'])

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const guard = await requireAdmin('clinic_manage')
  if (!guard.user) return guard.response
  try {
    const { searchParams } = new URL(request.url)
    const rawTab = searchParams.get('tab') as ClinicAdminTab | null
    const tab = rawTab && tabs.has(rawTab) ? rawTab : 'records'
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    return clinicOk(await listClinicAdminData(tab, page))
  } catch (error) {
    return clinicErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('clinic_manage')
  if (!guard.user) return guard.response
  try {
    const body = await request.json().catch(() => null)
    if (body?.action === 'report') {
      if (typeof body.reportId !== 'string' || !reportStatuses.has(body.status)) return NextResponse.json({ ok: false, message: '举报处理参数不正确。' }, { status: 400, headers: clinicPublicHeaders })
      return clinicOk(await handleClinicReport({ reportId: body.reportId, status: body.status, adminId: guard.user.id }))
    }
    if ((body?.target !== 'record' && body?.target !== 'consultation') || typeof body.id !== 'string' || !statuses.has(body.status)) {
      return NextResponse.json({ ok: false, message: '门诊内容处理参数不正确。' }, { status: 400, headers: clinicPublicHeaders })
    }
    await updateClinicAdminContent({ target: body.target, id: body.id, status: body.status, adminId: guard.user.id })
    return clinicOk({ updated: true })
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
