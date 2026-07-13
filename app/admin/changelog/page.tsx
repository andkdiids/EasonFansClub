import { AdminChangelogPanel } from '@/app/admin/changelog/AdminChangelogPanel'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export const dynamic = 'force-dynamic'

export default async function AdminChangelogPage() {
  const user = await requireAdminPage('/admin/changelog', 'changelog_manage')

  return (
    <>
      <SiteHeader user={user} />
      <AdminChangelogPanel />
    </>
  )
}
