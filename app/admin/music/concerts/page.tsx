import { AdminConcertManager } from '@/app/admin/music/concerts/AdminConcertManager'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export default async function AdminConcertsPage() {
  const user = await requireAdminPage('/admin/music/concerts', 'music_manage')
  return <><SiteHeader user={user} /><AdminConcertManager /></>
}
