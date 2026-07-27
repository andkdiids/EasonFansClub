import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { AdminGuessSongManager } from './AdminGuessSongManager'

export const dynamic = 'force-dynamic'

export default async function AdminGuessSongPage() {
  const user = await requireAdminPage('/admin/entertainment/guess-song', 'entertainment_manage')
  return (
    <>
      <SiteHeader user={user} />
      <AdminGuessSongManager />
    </>
  )
}
