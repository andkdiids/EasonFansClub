import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { clinicErrorResponse, clinicOk, clinicPublicHeaders } from '@/lib/clinic-api'
import { getPublicClinicRecordDetail, removeClinicRecord } from '@/lib/clinic-service'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ recordId: string }> }

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { recordId } = await context.params
    const viewer = await getCurrentUser()
    const record = await getPublicClinicRecordDetail(recordId, viewer?.id || null)
    if (!record) return NextResponse.json({ ok: false, code: 'RECORD_NOT_FOUND', message: '这份病历不存在。' }, { status: 404, headers: clinicPublicHeaders })
    return clinicOk({ record })
  } catch (error) {
    return clinicErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { recordId } = await context.params
    const canManage = await hasAdminPermission(guard.user, 'clinic_manage')
    await removeClinicRecord(recordId, guard.user.id, canManage)
    return clinicOk({ deleted: true })
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
