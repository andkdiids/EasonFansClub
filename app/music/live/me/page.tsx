import { redirect } from 'next/navigation'
import { MyLiveDashboard } from '@/components/music/live/MyLiveDashboard'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'
import { getCurrentUser } from '@/lib/auth'
import { getPersonalLiveOverview } from '@/lib/music-personal-live'
import { getSiteAppearance } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

export default async function MyLivePage({ searchParams }: { searchParams: Promise<{ tourId?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fmusic%2Flive%2Fme')
  const { tourId } = await searchParams
  const [overview, config] = await Promise.all([
    getPersonalLiveOverview(user.id),
    getSiteAppearance(),
  ])
  const data = JSON.parse(JSON.stringify(overview))
  return <MusicArchiveShell backgroundVisual={config.heroVisuals.music}>
    <MyLiveDashboard data={data} batchTourId={tourId?.trim() || undefined} />
  </MusicArchiveShell>
}
