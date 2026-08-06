import { AdminTourManager } from '@/app/admin/music/tours/AdminTourManager'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { getConcertCategories } from '@/lib/music-concert-category'

export default async function AdminToursPage() {
  const user = await requireAdminPage('/admin/music/tours', 'music_manage')
  const categories = await getConcertCategories().catch(() => [])
  return <><SiteHeader user={user} /><AdminTourManager categories={categories} /></>
}
