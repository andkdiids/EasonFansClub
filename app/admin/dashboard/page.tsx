import { requireAdminPage } from '@/components/AdminAccess'
import { DashboardRankings } from './DashboardRankings'

export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage() {
  await requireAdminPage('/admin/dashboard', 'stats_view')

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:space-y-6 sm:px-5 sm:py-8">
      <DashboardRankings />
    </main>
  )
}
