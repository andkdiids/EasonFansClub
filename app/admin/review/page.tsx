import { requireAdminPage } from '@/components/AdminAccess'
import { ReviewCenter } from './ReviewCenter'

export const dynamic = 'force-dynamic'

export default async function AdminReviewCenterPage({ searchParams }: { searchParams: Promise<{ type?: string | string[]; targetId?: string | string[]; sourceId?: string | string[]; reviewId?: string | string[] }> }) {
  await requireAdminPage('/admin/review')
  const params = await searchParams
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type
  const rawTargetId = Array.isArray(params.targetId) ? params.targetId[0] : params.targetId
  const rawSourceId = Array.isArray(params.sourceId) ? params.sourceId[0] : params.sourceId
  const rawReviewId = Array.isArray(params.reviewId) ? params.reviewId[0] : params.reviewId
  return <ReviewCenter initialType={rawType || 'ALL'} initialTargetId={rawTargetId || rawSourceId || rawReviewId || ''} />
}
