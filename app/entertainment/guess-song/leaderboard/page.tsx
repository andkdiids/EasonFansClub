import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { getCurrentUser } from '@/lib/auth'
import { getGuessSongLeaderboard } from '@/lib/guess-song-leaderboard'
import { GuessSongLeaderboard } from './GuessSongLeaderboard'

export const dynamic = 'force-dynamic'

const ALLOWED_MODES = ['EASY', 'ADVANCED', 'HARD', 'EXPERT'] as const
type PageProps = { searchParams?: Promise<{ period?: string; mode?: string }> }

export default async function GuessSongLeaderboardPage({ searchParams }: PageProps) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fentertainment%2Fguess-song%2Fleaderboard')
  const query = await searchParams
  // URL searchParams 为最高优先级，直接决定首次渲染的周期与模式
  const period = query?.period
  const initialPeriod = period === 'MONTH' ? 'MONTH' : period === 'YEAR' ? 'YEAR' : 'WEEK'
  const rawMode = query?.mode
  const initialMode = rawMode && (ALLOWED_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as (typeof ALLOWED_MODES)[number])
    : 'EASY'

  // 服务端预取当前周期数据，避免客户端首屏先默认再切换导致的错误数据闪屏
  let initialData: Awaited<ReturnType<typeof getGuessSongLeaderboard>> | null = null
  try {
    initialData = await getGuessSongLeaderboard({ userId: user.id, periodType: initialPeriod, mode: initialMode })
  } catch {
    initialData = null
  }

  return (
    <PageContainer className="guess-song-page">
      <GuessSongLeaderboard initialPeriod={initialPeriod} initialMode={initialMode} initialData={initialData} />
    </PageContainer>
  )
}
