import { AdminAlbumReviewManager } from '@/app/admin/music/reviews/AdminAlbumReviewManager'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export default async function AdminAlbumReviewsPage() {
  const user = await requireAdminPage('/admin/music/reviews', 'music_manage')
  return <><SiteHeader user={user} /><AdminAlbumReviewManager /></>
}
