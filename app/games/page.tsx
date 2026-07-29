import { redirect } from 'next/navigation'
import { GameCenter } from '@/components/games/GameCenter'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function GamesPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames')
  return <GameCenter />
}
