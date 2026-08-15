import { redirect } from 'next/navigation'
import { ConcertContributionComposer } from '@/components/music/ConcertContributionComposer'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { getCurrentUser } from '@/lib/auth'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function ConcertContributionPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fmusic%2Fconcerts%2Fcontribute')
  const config = await getSiteAppearance()
  return <MusicArchiveShell backgroundVisual={config.heroVisuals.music}><ConcertContributionComposer /></MusicArchiveShell>
}
