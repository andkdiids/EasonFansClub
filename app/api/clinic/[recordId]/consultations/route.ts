import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { clinicErrorResponse, clinicOk, clinicPublicHeaders } from '@/lib/clinic-api'
import { parseClinicIdentityMode } from '@/lib/clinic-config'
import { createClinicConsultation, getPublicClinicRecordDetail } from '@/lib/clinic-service'
import { requireUser, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ recordId: string }> }

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: Request, context: RouteContext) {
  let recordId = ''
  try {
    ({ recordId } = await context.params)
    const viewer = await getCurrentUser()
    const record = await getPublicClinicRecordDetail(recordId, viewer?.id || null)
    if (!record) return NextResponse.json({ ok: false, code: 'RECORD_NOT_FOUND', message: '这份病历不存在。' }, { status: 404, headers: clinicPublicHeaders })
    if ('unavailable' in record) return clinicOk({ consultations: [] })
    return clinicOk({ consultations: record.consultations })
  } catch (error) {
    return clinicErrorResponse(error, { action: 'clinic.consultation.list', recordId })
  }
}

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  let recordId = ''
  let body: { content?: unknown; identityMode?: unknown; parentId?: unknown } | null = null
  try {
    ({ recordId } = await context.params)
    body = await request.json().catch(() => null) as { content?: unknown; identityMode?: unknown; parentId?: unknown } | null
    const created = await createClinicConsultation({
      authorId: guard.user.id,
      recordId,
      content: body?.content,
      identityMode: parseClinicIdentityMode(body?.identityMode),
      parentId: sanitizeText(body?.parentId, 80) || null,
    })
    const record = await getPublicClinicRecordDetail(recordId, guard.user.id)
    return clinicOk({ consultationId: created.id, record }, 201)
  } catch (error) {
    return clinicErrorResponse(error, {
      action: 'clinic.consultation.create',
      recordId,
      userId: guard.user.id,
      anonymous: body?.identityMode === 'ANONYMOUS',
      contentLength: typeof body?.content === 'string' ? body.content.length : 0,
    })
  }
}
