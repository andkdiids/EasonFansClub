import { requireUser } from '@/lib/security'
import { getWantListenLeaderboard } from '@/lib/want-listen-leaderboard'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'
import { isWantListenMode, type WantListenMode } from '@/lib/want-listen-config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  const params = new URL(request.url).searchParams
  const rawMode = params.get('mode')
  const mode: WantListenMode = isWantListenMode(rawMode) ? rawMode : 'WANT_LISTEN'
  try {
    return wantListenOk(await getWantListenLeaderboard({ mode, period: params.get('period'), userId: guard.user.id }))
  } catch (error) {
    return handleWantListenError(error, 'leaderboard')
  }
}
