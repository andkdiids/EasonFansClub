import { AdminConcertManager } from '@/app/admin/music/concerts/AdminConcertManager'
import { requireAdminPage } from '@/components/AdminAccess'

export default async function AdminConcertsPage() {
  const user = await requireAdminPage('/admin/music/concerts', 'music_manage')
  return <><AdminConcertManager /></>
}
