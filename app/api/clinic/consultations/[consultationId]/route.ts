import { hasAdminPermission } from '@/lib/admin-permissions'
import { clinicErrorResponse, clinicOk } from '@/lib/clinic-api'
import { removeClinicConsultation } from '@/lib/clinic-service'
import { enforceApiRateLimit, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ consultationId: string }> }

/**
 * Delete a clinic consultation.
 *
 * The author may delete their own row; a moderator holding `clinic_manage` may
 * delete any row without having to report it first. Permission is re-checked
 * here on the server — the hidden UI button is never the control.
 */
export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/clinic/consultations/[consultationId]:DELETE',
    ip: { limit: 40, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  })
  if (limited) return limited

  try {
    const { consultationId } = await context.params
    if (!consultationId || typeof consultationId !== 'string') {
      return clinicErrorResponse(new Error('INVALID_CONSULTATION_ID'))
    }
    const canManage = await hasAdminPermission(guard.user, 'clinic_manage')
    // A moderator may attach a short reason; it is stored in the audit row only.
    const body = await request.json().catch(() => null) as { reason?: unknown } | null
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 200) : null

    const result = await removeClinicConsultation(consultationId, guard.user.id, canManage, { reason })
    return clinicOk({
      deleted: true,
      changed: result?.changed ?? false,
      alreadyDeleted: result?.alreadyDeleted ?? false,
      recordId: result?.recordId ?? null,
      moderated: canManage,
    })
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
