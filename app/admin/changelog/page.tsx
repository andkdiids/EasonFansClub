import { AdminChangelogPanel } from '@/app/admin/changelog/AdminChangelogPanel'
import { requireAdminPage } from '@/components/AdminAccess'

export const dynamic = 'force-dynamic'

export default async function AdminChangelogPage() {
  const user = await requireAdminPage('/admin/changelog', 'changelog_manage')

  return (
    <>
      
      <AdminChangelogPanel />
    </>
  )
}
