import { notFound, redirect } from 'next/navigation'
import { DailyPrescriptionDetail } from '@/components/games/DailyPrescriptionDetail'
import { GameDetailLayout } from '@/components/games/GameDetailLayout'
import { GuessSongDetail } from '@/components/games/GuessSongDetail'
import { getCurrentUser } from '@/lib/auth'
import { findGame } from '@/lib/game-catalog'

export const dynamic = 'force-dynamic'

export default async function GameDetailPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/games/${slug}`)}`)
  const game = findGame(slug)
  if (!game) notFound()

  if (game.slug === 'guess-song') return <GuessSongDetail game={game} />

  const actions = game.slug === 'daily-prescription'
    ? <div className="game-detail-actions"><a href="#daily-prescription">立即领取</a></div>
    : <div className="game-detail-actions"><button type="button" disabled>即将开放</button></div>

  return (
    <GameDetailLayout game={game} actions={actions}>
      {game.slug === 'daily-prescription' ? <div id="daily-prescription"><DailyPrescriptionDetail /></div> : null}
    </GameDetailLayout>
  )
}
