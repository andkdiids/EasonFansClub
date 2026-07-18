import { AdminMusicManager } from '@/app/admin/music/AdminMusicManager'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export const dynamic = 'force-dynamic'

export default async function AdminMusicPage() {
  const user = await requireAdminPage('/admin/music', 'music_manage')
  return (
    <>
      <SiteHeader user={user} />
      <AdminMusicManager />
    </>
  )
}
