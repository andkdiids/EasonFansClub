import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { getUndercoverMatchState, getUndercoverRoomState, startUndercoverMatch } from '@/lib/undercover-star'
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
    const result = await startUndercoverMatch(guard.user.id, roomId)
    await undercoverRealtimeHub.broadcastRoom(roomId)
    undercoverRealtimeHub.broadcastMatchState(result.matchId)
    const match = await getUndercoverMatchState(guard.user.id, result.matchId)
    undercoverRealtimeHub.scheduleMatch(result.matchId, match.snapshot.phaseDeadline)
    return undercoverOk({ room: await getUndercoverRoomState(guard.user.id, roomId), match }, { status: 201 })
  } catch (error) {
    return undercoverError(error, '开始卧底巨星失败。')
  }
}
