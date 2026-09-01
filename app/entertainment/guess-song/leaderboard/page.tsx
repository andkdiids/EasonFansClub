import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { getCurrentUser } from '@/lib/auth'
import { getGuessSongLeaderboard } from '@/lib/guess-song-leaderboard'
import { getBeijingDateKey } from '@/lib/beijing-time'
import { parseGameRankingRangeKey, resolveGameRankingRange, type GameRankingRangeKey } from '@/lib/game-ranking-range'
import { GuessSongLeaderboard } from './GuessSongLeaderboard'

export const dynamic = 'force-dynamic'

const ALLOWED_MODES = ['EASY', 'ADVANCED', 'HARD', 'EXPERT'] as const
type PageProps = { searchParams?: Promise<{ period?: string; range?: string; date?: string; mode?: string }> }

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
  return { range: 'this-week' as const, date: null }
}

export default async function GuessSongLeaderboardPage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fentertainment%2Fguess-song%2Fleaderboard')
  const query = await searchParams
  const todayDate = getBeijingDateKey()
  const initialRange = resolveInitialRange(query || {})
  const rawMode = query?.mode
  const initialMode = rawMode && (ALLOWED_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as (typeof ALLOWED_MODES)[number])
    : 'EASY'

  // 服务端预取 URL 指定范围，避免客户端首屏先默认再切换导致的错误数据闪屏
  let initialData: Awaited<ReturnType<typeof getGuessSongLeaderboard>> | null = null
  try {
    initialData = await getGuessSongLeaderboard({
      userId: user.id,
      mode: initialMode,
      range: initialRange.range,
      date: initialRange.date || undefined,
    })
  } catch {
    initialData = null
  }

  return (
    <PageContainer className="guess-song-page">
      <GuessSongLeaderboard
        initialRange={initialRange.range as GameRankingRangeKey}
        initialDate={initialRange.date}
        todayDate={todayDate}
        initialMode={initialMode}
        initialData={initialData}
      />
    </PageContainer>
  )
}
