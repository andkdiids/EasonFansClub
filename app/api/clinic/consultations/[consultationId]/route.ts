import { hasAdminPermission } from '@/lib/admin-permissions'
import { clinicErrorResponse, clinicOk } from '@/lib/clinic-api'
import { removeClinicConsultation } from '@/lib/clinic-service'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ consultationId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { consultationId } = await context.params
    const canManage = await hasAdminPermission(guard.user, 'clinic_manage')
    await removeClinicConsultation(consultationId, guard.user.id, canManage)
    return clinicOk({ deleted: true })
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
