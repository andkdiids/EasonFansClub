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
    const match = await getUndercoverMatchState(guard.user.id, result.matchId)
    // 业务 mutation 已成功，HTTP 必须返回成功；广播失败不得影响业务结果。
    try {
      await undercoverRealtimeHub.broadcastRoom(roomId)
      undercoverRealtimeHub.broadcastMatchState(result.matchId)
      undercoverRealtimeHub.scheduleMatch(result.matchId, match.snapshot.phaseDeadline)
    } catch (broadcastError) {
      console.error('[undercover-star.broadcast] start', broadcastError)
    }
    return undercoverOk({ room: await getUndercoverRoomState(guard.user.id, roomId), match }, { status: 201 })
  } catch (error) {
    return undercoverError(error, '开始卧底巨星失败。')
  }
}
