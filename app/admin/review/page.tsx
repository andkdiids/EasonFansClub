import { requireAdminPage } from '@/components/AdminAccess'
import { ReviewCenter } from './ReviewCenter'

export const dynamic = 'force-dynamic'

export default async function AdminReviewCenterPage({ searchParams }: { searchParams: Promise<{ type?: string | string[] }> }) {
  await requireAdminPage('/admin/review')
  const params = await searchParams
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type
  return <ReviewCenter initialType={rawType || 'ALL'} />
}
