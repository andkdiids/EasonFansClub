import { requireAdminPage } from '@/components/AdminAccess'
import { LeaderboardRewardsAdmin } from './LeaderboardRewardsAdmin'

export const dynamic = 'force-dynamic'

export default async function LeaderboardRewardsAdminPage() {
  await requireAdminPage('/admin/leaderboard-rewards', 'site_config_manage')
  return <LeaderboardRewardsAdmin />
}
