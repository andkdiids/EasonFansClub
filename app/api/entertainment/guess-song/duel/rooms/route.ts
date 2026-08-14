import { createDuelRoom, listDuelRooms, resolveActiveDuelForUser, searchDuelRoom } from '@/lib/guess-song-duel-service'
import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const q = new URL(request.url).searchParams.get('q')
  try {
    if (q) return duelOk({ rooms: [await searchDuelRoom(q)] })
    const activeState = await resolveActiveDuelForUser(guard.user.id)
    for (const affectedRoom of activeState.affectedRooms) await duelRealtimeHub.broadcastRoom(affectedRoom.id, affectedRoom)
    return duelOk({
      rooms: await listDuelRooms(),
      activeRoom: activeState.activeRoom,
      activeMatch: activeState.activeMatch,
      isInActiveDuel: activeState.isInActiveDuel,
    })
  } catch (error) {
    if (q) return duelError(error)
    return duelError(error, 'Unable to load duel rooms')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const result = await createDuelRoom(guard.user.id, {
      roomCode: body?.roomCode,
      password: body?.password,
      mode: body?.mode,
    })
    for (const affectedRoom of result.affectedRooms) await duelRealtimeHub.broadcastRoom(affectedRoom.id, affectedRoom)
    return duelOk({ room: result.room })
  } catch (error) {
    return duelError(error, 'Unable to create duel room')
  }
}
