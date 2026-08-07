import { requireAdminPage } from '@/components/AdminAccess'

import { AdminGuessSongManager } from './AdminGuessSongManager'

export const dynamic = 'force-dynamic'

export default async function AdminGuessSongPage() {
  const user = await requireAdminPage('/admin/entertainment/guess-song', 'entertainment_manage')
  return (
    <>
      
      <AdminGuessSongManager />
    </>
  )
}
