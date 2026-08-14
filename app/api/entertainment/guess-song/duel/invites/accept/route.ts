import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { acceptDuelInvite } from '@/lib/guess-song-duel-service'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const result = await acceptDuelInvite(guard.user.id, body?.inviteToken)
    for (const affectedRoom of result.affectedRooms) await duelRealtimeHub.broadcastRoom(affectedRoom.id, affectedRoom)
    await duelRealtimeHub.broadcastRoom(result.room.id, result.room)
    return duelOk({ room: result.room })
  } catch (error) {
    return duelError(error, 'This duel invitation is no longer available')
  }
}
