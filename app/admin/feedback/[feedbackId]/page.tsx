import { AdminFeedbackPanel } from '@/app/admin/feedback/AdminFeedbackPanel'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export const dynamic = 'force-dynamic'

export default async function AdminFeedbackDetailPage({ params }: { params: Promise<{ feedbackId: string }> }) {
  const user = await requireAdminPage('/admin/feedback', 'feedback_manage')
  const { feedbackId } = await params

  return (
    <>
      <SiteHeader user={user} />
      <AdminFeedbackPanel initialFeedbackId={feedbackId} />
    </>
  )
}
