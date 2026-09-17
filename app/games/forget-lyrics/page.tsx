import { redirect } from 'next/navigation'
import { ForgetLyricsPage } from '@/components/games/ForgetLyrics'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ForgetLyricsRoute() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames%2Fforget-lyrics')
  return <ForgetLyricsPage />
}
