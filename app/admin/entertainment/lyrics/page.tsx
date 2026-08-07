import { requireAdminPage } from '@/components/AdminAccess'

import { AdminLyricsManager } from './AdminLyricsManager'

export const dynamic = 'force-dynamic'

export default async function AdminLyricsPage() {
  const user = await requireAdminPage('/admin/entertainment/lyrics', 'entertainment_manage')
  return (
    <>
      
      <AdminLyricsManager />
    </>
  )
}
