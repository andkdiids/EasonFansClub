import { redirect } from 'next/navigation'
import { requireAdminPage } from '@/components/AdminAccess'
import { CantoneseAdminReviewCenter } from './CantoneseAdminReviewCenter'

export const dynamic = 'force-dynamic'

export default async function CantoneseAdminPage() {
  const user = await requireAdminPage('/admin/cantonese', 'cantonese_review')
  if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
    redirect('/admin/no-access?from=%2Fadmin%2Fcantonese')
  }
  return <CantoneseAdminReviewCenter />
}
