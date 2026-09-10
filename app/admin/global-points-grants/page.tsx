import { requireAdminPage } from '@/components/AdminAccess'
import { getGlobalPointsGrantOverview } from '@/lib/global-points-grant'
import { GLOBAL_POINTS_GRANT_PERMISSION } from '@/lib/global-points-grant-constants'
import { GlobalPointsGrantManager } from './GlobalPointsGrantManager'

export const dynamic = 'force-dynamic'

export default async function AdminGlobalPointsGrantsPage() {
  await requireAdminPage('/admin/global-points-grants', GLOBAL_POINTS_GRANT_PERMISSION)
  const overview = await getGlobalPointsGrantOverview()
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <GlobalPointsGrantManager initialOverview={overview} />
    </main>
  )
}
