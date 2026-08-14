import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { getDuelMatchState } from '@/lib/guess-song-duel-service'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { matchId } = await params
  try {
    const match = await getDuelMatchState(guard.user.id, matchId)
    if (match.status === 'PLAYING' && match.question) {
      const nextAt = match.phase === 'STARTING' ? match.question.serverStartedAt : match.question.answerDeadlineAt
      duelRealtimeHub.scheduleMatch(matchId, nextAt)
    }
    return duelOk({ match })
  } catch (error) {
    return duelError(error, 'Unable to load duel match')
  }
}
