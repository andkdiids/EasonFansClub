import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { createUndercoverRoom, getUndercoverRoomByCode, listUndercoverRooms, resolveActiveUndercoverState } from '@/lib/undercover-star'
import { undercoverError, undercoverInputError, undercoverOk, readUndercoverString } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const query = new URL(request.url).searchParams.get('q')
    const active = await resolveActiveUndercoverState(guard.user.id)
    if (query) {
      const room = await getUndercoverRoomByCode(query)
      return undercoverOk({ rooms: [room], ...active })
    }
    return undercoverOk({ rooms: await listUndercoverRooms(), ...active })
  } catch (error) {
    return undercoverError(error, '暂时无法加载卧底巨星房间。')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limit = await consumeRateLimit(guard.user.id, 'undercover-star-room-create', 8, 60)
  if (limit.limited) return undercoverInputError('创建房间过于频繁，请稍后再试。', 'RATE_LIMITED', 429)
  const body = await request.json().catch(() => null) as { password?: unknown } | null
  try {
    const result = await createUndercoverRoom(guard.user.id, { password: readUndercoverString(body?.password, 32) })
    for (const room of result.affectedRooms) await undercoverRealtimeHub.broadcastRoom(room.roomId)
    await undercoverRealtimeHub.broadcastRoom(result.room.roomId)
    return undercoverOk({ room: result.room }, { status: 201 })
  } catch (error) {
    return undercoverError(error, '创建卧底巨星房间失败。')
  }
}
