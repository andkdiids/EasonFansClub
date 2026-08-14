import { duelError, duelInputError, duelOk } from '@/lib/guess-song-duel-api'
import { getDuelRoomState, startDuelMatch } from '@/lib/guess-song-duel-service'
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
    const room = await getDuelRoomState(roomId)
    if (room.host.id !== guard.user.id) return duelInputError('只有房主可以开始游戏', 'HOST_ONLY', 403)
    if (!room.challenger) {
      return duelInputError('对方当前不在线，请等待对方重新进入房间。', 'PLAYERS_NOT_ONLINE', 409)
    }
    const result = await startDuelMatch(guard.user.id, roomId)
    duelRealtimeHub.broadcastRoom(roomId)
    duelRealtimeHub.broadcastMatchStarting(result.matchId, result.serverStartAt)
    duelRealtimeHub.scheduleMatch(result.matchId, result.serverStartAt)
    return duelOk({ matchId: result.matchId, serverStartAt: result.serverStartAt })
  } catch (error) {
    return duelError(error, 'Unable to start duel')
  }
}
