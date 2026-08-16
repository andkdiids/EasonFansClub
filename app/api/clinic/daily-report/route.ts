import { clinicErrorResponse, clinicOk } from '@/lib/clinic-api'
import { getClinicDailyReport } from '@/lib/clinic-service'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    return clinicOk(await getClinicDailyReport())
  } catch (error) {
    return clinicErrorResponse(error)
  }
}
