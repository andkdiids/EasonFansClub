import type { GuessSongPeriodType } from '@prisma/client'
import { requireUser } from '@/lib/security'
import { getGuessSongLeaderboard } from '@/lib/guess-song-leaderboard'
import { isGuessSongPublicMode } from '@/lib/guess-song-config'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const params = new URL(request.url).searchParams
  const rawPeriod = params.get('period')
  const periodType: GuessSongPeriodType | 'YEAR' =
    rawPeriod === 'MONTH' ? 'MONTH' : rawPeriod === 'YEAR' ? 'YEAR' : 'WEEK'
  const rawMode = params.get('mode')
  const mode = rawMode && isGuessSongPublicMode(rawMode) ? rawMode : 'EASY'
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
