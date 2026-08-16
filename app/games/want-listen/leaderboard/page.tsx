import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { WantListenLeaderboard } from '../WantListenLeaderboard'

export const dynamic = 'force-dynamic'

export default async function WantListenLeaderboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames%2Fwant-listen%2Fleaderboard')
  return <WantListenLeaderboard />
}
