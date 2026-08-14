import { requireAdminPage } from '@/components/AdminAccess'
import { AdminActionLogManager } from './AdminActionLogManager'

export const dynamic = 'force-dynamic'

export default async function AdminActionsPage() {
  await requireAdminPage('/admin/admin-actions', 'post_manage')

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-5 sm:py-8">
      <AdminActionLogManager />
    </main>
  )
}

