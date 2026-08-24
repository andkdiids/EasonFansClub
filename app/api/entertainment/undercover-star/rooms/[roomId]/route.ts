import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { enterUndercoverRoom, getUndercoverRoomState } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { roomId } = await params
    return undercoverOk({ room: await getUndercoverRoomState(guard.user.id, roomId) })
  } catch (error) {
    return undercoverError(error, '暂时无法恢复房间。')
  }
}

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { roomId } = await params
    const room = await enterUndercoverRoom(guard.user.id, roomId)
    // Returning to a retained room is a real presence mutation.  Broadcast is
    // best-effort because the persisted room state is already authoritative.
    try {
      await undercoverRealtimeHub.broadcastRoom(roomId)
    } catch (broadcastError) {
      console.error('[undercover-star.broadcast] enter-room', broadcastError)
    }
    return undercoverOk({ room })
  } catch (error) {
    return undercoverError(error, '返回房间失败。')
  }
}
