import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { getCurrentUser } from '@/lib/auth'
import { GuessSongGame } from './GuessSongGame'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams?: Promise<{ session?: string }> }

export default async function GuessSongPage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fentertainment%2Fguess-song')
  const query = await searchParams
  return (
    <PageContainer className="guess-song-page">
      <GuessSongGame initialSessionId={query?.session || null} />
    </PageContainer>
  )
}
