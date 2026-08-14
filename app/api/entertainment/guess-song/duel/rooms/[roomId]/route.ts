import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { enterDuelRoom } from '@/lib/guess-song-duel-service'
import { requireUser } from '@/lib/security'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { roomId } = await params
  try {
    const result = await enterDuelRoom(guard.user.id, roomId)
    for (const affectedRoom of result.affectedRooms) await duelRealtimeHub.broadcastRoom(affectedRoom.id, affectedRoom)
    return duelOk({ room: result.room })
  } catch (error) {
    return duelError(error, 'Unable to load duel room')
  }
}
