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
  const rawRange = params.get('range')
  const rawPeriod = params.get('period')
  if (!rawRange && rawPeriod !== null && rawPeriod !== '' && rawPeriod !== 'WEEK' && rawPeriod !== 'MONTH' && rawPeriod !== 'YEAR') {
    return guessSongError('请选择有效榜单周期', 400, 'INVALID_PERIOD')
  }
  const periodType =
    rawPeriod === 'MONTH' ? 'MONTH' : rawPeriod === 'YEAR' ? 'YEAR' : 'WEEK'
  const rawMode = params.get('mode')
  const mode = rawMode && isGuessSongPublicMode(rawMode) ? rawMode : 'EASY'
  try {
    return guessSongOk(await getGuessSongLeaderboard({
      userId: guard.user.id,
      periodType,
      mode,
      range: rawRange || undefined,
      date: params.get('date') || undefined,
    }))
  } catch (error) {
    return handleGuessSongError(error, 'leaderboard')
  }
}
