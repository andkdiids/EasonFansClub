import { requireAdminPage } from '@/components/AdminAccess'
import {
  listUserRewardOperators,
  listUserRewards,
  USER_REWARD_PERMISSION,
} from '@/lib/user-rewards'
import { UserRewardManager } from './UserRewardManager'

export const dynamic = 'force-dynamic'

export default async function AdminUserRewardsPage() {
  await requireAdminPage('/admin/user-rewards', USER_REWARD_PERMISSION)
  const [history, operators] = await Promise.all([
    listUserRewards({ page: 1 }),
    listUserRewardOperators(),
  ])

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <UserRewardManager initialHistory={history} operators={operators} />
    </main>
  )
}
