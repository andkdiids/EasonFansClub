import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { getUndercoverRoomIdByCode, getUndercoverRoomState, joinUndercoverRoom } from '@/lib/undercover-star'
import { undercoverError, undercoverInputError, undercoverOk, readUndercoverString } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limit = await consumeRateLimit(guard.user.id, 'undercover-star-room-join', 20, 60)
  if (limit.limited) return undercoverInputError('加入房间过于频繁，请稍后再试。', 'RATE_LIMITED', 429)
  const body = await request.json().catch(() => null) as { roomCode?: unknown; password?: unknown } | null
  try {
    const roomId = await getUndercoverRoomIdByCode(body?.roomCode)
    const result = await joinUndercoverRoom(guard.user.id, roomId, { password: readUndercoverString(body?.password, 32) })
    for (const affected of result.affectedRooms) await undercoverRealtimeHub.broadcastRoom(affected.roomId)
    const state = await getUndercoverRoomState(guard.user.id, result.room.roomId)
    await undercoverRealtimeHub.broadcastRoom(state.roomId)
    return undercoverOk({ room: state })
  } catch (error) {
    return undercoverError(error, '加入卧底巨星房间失败。')
  }
}
