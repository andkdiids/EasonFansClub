import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { WantListenGame } from '../WantListenGame'

export const dynamic = 'force-dynamic'

export default async function WantListenPlayPage({ searchParams }: Readonly<{ searchParams?: Promise<{ session?: string }> }>) {
  const query = await searchParams
  const user = await getCurrentUser()
  const redirectTarget = query?.session ? `/games/want-listen/play?session=${encodeURIComponent(query.session)}` : '/games/want-listen'
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`)
  if (!query?.session) redirect('/games/want-listen')
  if (!query.session.trim()) notFound()
  return <WantListenGame initialSessionId={query.session} />
}
