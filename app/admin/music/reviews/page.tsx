import { AdminAlbumReviewManager } from '@/app/admin/music/reviews/AdminAlbumReviewManager'
import { requireAdminPage } from '@/components/AdminAccess'

export default async function AdminAlbumReviewsPage() {
  const user = await requireAdminPage('/admin/music/reviews', 'music_manage')
  return <><AdminAlbumReviewManager /></>
}
