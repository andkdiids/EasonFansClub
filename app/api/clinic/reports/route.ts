import { clinicErrorResponse, clinicOk } from '@/lib/clinic-api'
import { createClinicReport } from '@/lib/clinic-service'
import { requireUser, sanitizeText } from '@/lib/security'

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const body = await request.json().catch(() => null)
    const report = await createClinicReport({
      reporterId: guard.user.id,
      recordId: typeof body?.recordId === 'string' ? sanitizeText(body.recordId, 80) : undefined,
      consultationId: typeof body?.consultationId === 'string' ? sanitizeText(body.consultationId, 80) : undefined,
      reason: sanitizeText(body?.reason, 80),
      detail: sanitizeText(body?.detail, 500),
    })
    return clinicOk(report, 201)
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
