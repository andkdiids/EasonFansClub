import { redirect } from 'next/navigation'
import { GuessSongDuel } from '@/components/games/GuessSongDuel'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function GuessSongDuelPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames%2Fguess-song%2Fduel')
  const params = await searchParams
  return <GuessSongDuel userId={user.id} initialInviteToken={typeof params.invite === 'string' ? params.invite : null} />
}
