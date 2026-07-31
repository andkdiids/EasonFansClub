import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { getCurrentUser } from '@/lib/auth'
import { GuessSongLeaderboard } from './GuessSongLeaderboard'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams?: Promise<{ period?: string; mode?: string }> }

export default async function GuessSongLeaderboardPage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fentertainment%2Fguess-song%2Fleaderboard')
  const query = await searchParams
  const period = query?.period
  const initialPeriod = period === 'MONTH' ? 'MONTH' : period === 'YEAR' ? 'YEAR' : 'WEEK'
  return (
    <PageContainer className="guess-song-page">
      <GuessSongLeaderboard initialPeriod={initialPeriod} initialMode={query?.mode || 'ALL'} />
    </PageContainer>
  )
}
