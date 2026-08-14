import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { getDuelMatchState, getDuelRoomState, startDuelMatch } from '@/lib/guess-song-duel-service'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { roomId } = await params
  try {
    const result = await startDuelMatch(guard.user.id, roomId)
    const [room, match] = await Promise.all([
      getDuelRoomState(roomId),
      getDuelMatchState(guard.user.id, result.matchId),
    ])
    await duelRealtimeHub.broadcastRoom(roomId, room)
    duelRealtimeHub.broadcastMatchStarting(result.matchId, result.serverStartAt, 1, result.questionCount)
    duelRealtimeHub.scheduleMatch(result.matchId, result.serverStartAt)
    return duelOk({ room, matchId: result.matchId, serverStartAt: result.serverStartAt, match })
  } catch (error) {
    return duelError(error, 'Unable to start duel')
  }
}
