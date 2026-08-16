import { getCurrentUser } from '@/lib/auth'
import { parseClinicCategory, parseClinicSort } from '@/lib/clinic-config'
import { listPublicClinicRecords } from '@/lib/clinic-service'
import { ClinicHomeClient } from '@/components/clinic/ClinicHomeClient'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClinicPage({ searchParams }: { searchParams: Promise<{ page?: string; category?: string; sort?: string }> }) {
  const params = await searchParams
  const user = await getCurrentUser().catch(() => null)
  const category = parseClinicCategory(params.category)
  const sort = parseClinicSort(params.sort)
  const initialData = await listPublicClinicRecords({
    page: Math.max(1, Number.parseInt(params.page || '1', 10) || 1),
    category,
    sort,
    viewerId: user?.id || null,
  })
  return <ClinicHomeClient initialData={initialData} initialCategory={category} initialSort={sort} isAuthenticated={Boolean(user)} />
}
