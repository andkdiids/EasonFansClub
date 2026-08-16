import { requireUser } from '@/lib/security'
import { clinicErrorResponse, clinicOk } from '@/lib/clinic-api'
import { giveClinicMouthpiece, removeClinicMouthpiece } from '@/lib/clinic-service'

type RouteContext = { params: Promise<{ consultationId: string }> }

export async function POST(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { consultationId } = await context.params
    return clinicOk(await giveClinicMouthpiece(guard.user.id, consultationId))
  } catch (error) {
    return clinicErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { consultationId } = await context.params
    return clinicOk(await removeClinicMouthpiece(guard.user.id, consultationId))
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
