import { MusicImportPanel } from '@/app/admin/music/import/MusicImportPanel'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'

export const dynamic = 'force-dynamic'

export default async function AdminMusicImportPage() {
  const user = await requireAdminPage('/admin/music/import', 'music_manage')
  return <><SiteHeader user={user} /><MusicImportPanel /></>
}
