import { clinicErrorResponse, clinicOk } from '@/lib/clinic-api'
import { getClinicMe } from '@/lib/clinic-service'
import { requireUser } from '@/lib/security'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    return clinicOk(await getClinicMe(guard.user.id))
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
