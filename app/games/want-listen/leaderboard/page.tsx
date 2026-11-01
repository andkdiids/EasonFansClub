import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { parseGameRankingRangeKey, resolveGameRankingRange, type GameRankingRangeKey } from '@/lib/game-ranking-range'
import { WantListenLeaderboard } from '../WantListenLeaderboard'

export const dynamic = 'force-dynamic'

type PageProps = { searchParams?: Promise<{ period?: string; range?: string; date?: string; startDate?: string; endDate?: string }> }

function resolveInitialRange(query: { period?: string; range?: string; date?: string; startDate?: string; endDate?: string }) {
  const requested = parseGameRankingRangeKey(query.range)
  if (requested) {
    try {
      const resolved = resolveGameRankingRange({ range: requested, date: query.date, startDate: query.startDate, endDate: query.endDate, now: new Date() })
      return { range: resolved.key, startDate: resolved.startDate, endDate: resolved.endDate }
    } catch {
      return { range: 'this-week' as const, startDate: null, endDate: null }
    }
  }
  if (query.period === 'MONTH') return { range: 'this-month' as const, startDate: null, endDate: null }
  if (query.period === 'TODAY' || query.period === 'DAY') {
    const today = getBeijingDateKey()
    return { range: 'date' as const, startDate: today, endDate: today }
  }
  return { range: 'this-week' as const, startDate: null, endDate: null }
}

export default async function WantListenLeaderboardPage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames%2Fwant-listen%2Fleaderboard')
  const query = await searchParams
  const initialRange = resolveInitialRange(query || {})
  const todayDate = getBeijingDateKey()
  return <WantListenLeaderboard initialRange={initialRange.range as GameRankingRangeKey} initialStartDate={initialRange.startDate} initialEndDate={initialRange.endDate} todayDate={todayDate} />
}
