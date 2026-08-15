import { AdminConcertContributionManager } from '@/app/admin/music/concerts/contributions/AdminConcertContributionManager'
import { requireAdminPage } from '@/components/AdminAccess'

export default async function AdminConcertContributionsPage() {
  await requireAdminPage('/admin/music/concerts/contributions', 'music_manage')
  return <AdminConcertContributionManager />
}
