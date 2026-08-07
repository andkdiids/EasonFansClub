import { AdminFeedbackPanel } from '@/app/admin/feedback/AdminFeedbackPanel'
import { requireAdminPage } from '@/components/AdminAccess'

export const dynamic = 'force-dynamic'

export default async function AdminFeedbackPage() {
  const user = await requireAdminPage('/admin/feedback', 'feedback_manage')

  return (
    <>
      
      <AdminFeedbackPanel />
    </>
  )
}
