import { requireAdminPage } from '@/components/AdminAccess'
import { parseReviewStatus } from '@/lib/review-center'
import { ReviewCenter } from './ReviewCenter'

export const dynamic = 'force-dynamic'

export default async function AdminReviewCenterPage({ searchParams }: { searchParams: Promise<{ type?: string | string[]; status?: string | string[]; targetId?: string | string[]; sourceId?: string | string[]; reviewId?: string | string[]; focus?: string | string[] }> }) {
  await requireAdminPage('/admin/review')
  const params = await searchParams
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type
  const rawStatus = Array.isArray(params.status) ? params.status[0] : params.status
  const rawTargetId = Array.isArray(params.targetId) ? params.targetId[0] : params.targetId
  const rawSourceId = Array.isArray(params.sourceId) ? params.sourceId[0] : params.sourceId
  const rawReviewId = Array.isArray(params.reviewId) ? params.reviewId[0] : params.reviewId
  const rawFocus = Array.isArray(params.focus) ? params.focus[0] : params.focus
  return <ReviewCenter initialType={rawType || 'ALL'} initialStatus={parseReviewStatus(rawStatus)} initialTargetId={rawTargetId || rawSourceId || rawReviewId || rawFocus || ''} />
}
