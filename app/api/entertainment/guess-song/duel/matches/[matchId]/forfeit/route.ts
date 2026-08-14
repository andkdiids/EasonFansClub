import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { forfeitDuelMatch } from '@/lib/guess-song-duel-service'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { matchId } = await params
  try {
    const result = await forfeitDuelMatch(guard.user.id, matchId)
    duelRealtimeHub.broadcastMatchState(matchId)
    duelRealtimeHub.publishCompletion(matchId, { questionResult: null, nextServerStartAt: null, matchResult: result })
    return duelOk({ result })
  } catch (error) {
    return duelError(error, 'Unable to leave the duel')
  }
}
