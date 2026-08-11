import { requireAdminPage } from '@/components/AdminAccess'

import { AdminGuessSongManager } from './AdminGuessSongManager'
import { GuessSongRiskManager } from './GuessSongRiskManager'

export const dynamic = 'force-dynamic'

export default async function AdminGuessSongPage() {
  await requireAdminPage('/admin/entertainment/guess-song', 'entertainment_manage')
  return (
    <>
      <AdminGuessSongManager />
      <GuessSongRiskManager />
    </>
  )
}
