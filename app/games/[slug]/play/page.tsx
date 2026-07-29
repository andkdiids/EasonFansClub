import { notFound, redirect } from 'next/navigation'
import { GuessSongGame } from '@/app/entertainment/guess-song/GuessSongGame'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function GamePlayPage({ params, searchParams }: Readonly<{
  params: Promise<{ slug: string }>
  searchParams?: Promise<{ session?: string; from?: string }>
}>) {
  const [{ slug }, query] = await Promise.all([params, searchParams])
  if (slug !== 'guess-song') notFound()
  const redirectTarget = query?.session
    ? `/games/guess-song/play?session=${encodeURIComponent(query.session)}`
    : '/games/guess-song'
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`)
  if (!query?.session) redirect('/games/guess-song')

  return (
    <GuessSongGame
      initialSessionId={query.session}
      exitTarget={query.from === 'hall' ? '/games' : '/games/guess-song'}
      hasKnownOrigin={query.from === 'hall' || query.from === 'detail'}
    />
  )
}
