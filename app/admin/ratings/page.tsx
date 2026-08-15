import { requireAdminPage } from '@/components/AdminAccess'
import { getAdminRatingOverview } from '@/lib/rating-service'
import { RatingAdminManager } from './RatingAdminManager'

export const dynamic = 'force-dynamic'

export default async function AdminRatingsPage() {
  await requireAdminPage('/admin/ratings', 'rating_manage')
  const overview = await getAdminRatingOverview()
  return <main className="mx-auto max-w-7xl space-y-5 px-4 py-7 sm:px-5"><RatingAdminManager initial={overview} /></main>
}
