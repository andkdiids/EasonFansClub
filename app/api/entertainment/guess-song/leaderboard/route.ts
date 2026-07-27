import type { GuessSongMode, GuessSongPeriodType } from '@prisma/client'
import { requireUser } from '@/lib/security'
import { getGuessSongLeaderboard } from '@/lib/guess-song-leaderboard'
import { isGuessSongMode } from '@/lib/guess-song-config'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const params = new URL(request.url).searchParams
  const periodType: GuessSongPeriodType = params.get('period') === 'MONTH' ? 'MONTH' : 'WEEK'
  const rawMode = params.get('mode')
  const mode: GuessSongMode | 'ALL' = rawMode && isGuessSongMode(rawMode) ? rawMode : 'ALL'
  try {
    return guessSongOk(await getGuessSongLeaderboard({
      userId: guard.user.id,
      periodType,
      mode,
    }))
  } catch (error) {
    return handleGuessSongError(error, 'leaderboard')
  }
}
