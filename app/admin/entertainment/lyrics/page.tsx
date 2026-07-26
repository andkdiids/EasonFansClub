import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { AdminLyricsManager } from './AdminLyricsManager'

export const dynamic = 'force-dynamic'

export default async function AdminLyricsPage() {
  const user = await requireAdminPage('/admin/entertainment/lyrics', 'entertainment_manage')
  return (
    <>
      <SiteHeader user={user} />
      <AdminLyricsManager />
    </>
  )
}
