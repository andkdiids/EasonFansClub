import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { leaveUndercoverRoom } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { roomId } = await params
    const result = await leaveUndercoverRoom(guard.user.id, roomId)
    for (const room of result.affectedRooms) await undercoverRealtimeHub.broadcastRoom(room.roomId)
    if (result.match) {
      undercoverRealtimeHub.broadcastMatchState(result.match.matchId)
      if (result.match.status === 'FINISHED') undercoverRealtimeHub.stopMatch(result.match.matchId)
      else undercoverRealtimeHub.scheduleMatch(result.match.matchId, result.match.phaseDeadline)
    }
    return undercoverOk({ left: true })
  } catch (error) {
    return undercoverError(error, '退出房间失败。')
  }
}
