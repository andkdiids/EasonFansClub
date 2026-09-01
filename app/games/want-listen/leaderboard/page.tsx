import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { parseGameRankingRangeKey, resolveGameRankingRange, type GameRankingRangeKey } from '@/lib/game-ranking-range'
import { WantListenLeaderboard } from '../WantListenLeaderboard'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams?: Promise<{ period?: string; range?: string; date?: string }> }

function resolveInitialRange(query: { period?: string; range?: string; date?: string }) {
  const requested = parseGameRankingRangeKey(query.range)
  if (requested) {
    try {
      const resolved = resolveGameRankingRange({ range: requested, date: query.date, now: new Date() })
      return { range: resolved.key, date: resolved.date }
    } catch {
      return { range: 'this-week' as const, date: null }
    }
  }
  if (query.period === 'MONTH') return { range: 'this-month' as const, date: null }
  if (query.period === 'TODAY' || query.period === 'DAY') return { range: 'date' as const, date: getBeijingDateKey() }
  return { range: 'this-week' as const, date: null }
}

export default async function WantListenLeaderboardPage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames%2Fwant-listen%2Fleaderboard')
  const query = await searchParams
  const initialRange = resolveInitialRange(query || {})
  const todayDate = getBeijingDateKey()
  return <WantListenLeaderboard initialRange={initialRange.range as GameRankingRangeKey} initialDate={initialRange.date} todayDate={todayDate} />
}
