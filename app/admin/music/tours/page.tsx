import { AdminTourManager } from '@/app/admin/music/tours/AdminTourManager'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export default async function AdminToursPage() {
  const user = await requireAdminPage('/admin/music/tours', 'music_manage')
  return <><SiteHeader user={user} /><AdminTourManager /></>
}
