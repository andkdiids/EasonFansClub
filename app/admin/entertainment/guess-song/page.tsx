import { requireAdminPage } from '@/components/AdminAccess'

import { AdminGuessSongManager } from './AdminGuessSongManager'
import { GuessSongLeaderboardManager } from './GuessSongLeaderboardManager'
import { GuessSongRiskManager } from './GuessSongRiskManager'

export const dynamic = 'force-dynamic'

export default async function AdminGuessSongPage() {
  await requireAdminPage('/admin/entertainment/guess-song', 'entertainment_manage')
  return (
    <>
      <AdminGuessSongManager />
      <GuessSongLeaderboardManager />
      <GuessSongRiskManager />
    </>
  )
}
