import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { clinicErrorResponse, clinicOk, clinicPublicHeaders } from '@/lib/clinic-api'
import { parseClinicCategory, parseClinicIdentityMode, parseClinicNeedType, parseClinicSort } from '@/lib/clinic-config'
import { createClinicRecord, listPublicClinicRecords } from '@/lib/clinic-service'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const viewer = await getCurrentUser()
    const limited = await enforceApiRateLimit(request, viewer?.id, {
      endpoint: '/api/clinic:GET',
      ip: { limit: 120, windowSeconds: 60 },
      user: { limit: 60, windowSeconds: 60 },
    })
    if (limited) return limited
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1)
    const pageSize = Math.min(50, Math.max(1, Number.parseInt(searchParams.get('pageSize') || '20', 10) || 20))
    const result = await listPublicClinicRecords({
      page,
      pageSize,
      category: parseClinicCategory(searchParams.get('category')),
      sort: parseClinicSort(searchParams.get('sort')),
      viewerId: viewer?.id || null,
    })
    return NextResponse.json({ ok: true, data: result }, { headers: clinicPublicHeaders })
  } catch (error) {
    return clinicErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/clinic:POST',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
  })
  if (limited) return limited
  try {
    const body = await request.json().catch(() => null)
    const category = parseClinicCategory(body?.category)
    const needType = parseClinicNeedType(body?.needType)
    if (!category || !needType) return NextResponse.json({ ok: false, code: 'INVALID_SELECTION', message: '请选择今日症状和患者诉求。' }, { status: 400, headers: clinicPublicHeaders })
    const record = await createClinicRecord({
      authorId: guard.user.id,
      content: sanitizeText(body?.content, 2000),
      category,
      needType,
      identityMode: parseClinicIdentityMode(body?.identityMode),
    })
    return clinicOk({ id: record.id }, 201)
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
