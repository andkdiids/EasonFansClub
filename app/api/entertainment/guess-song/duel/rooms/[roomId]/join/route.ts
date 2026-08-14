import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { joinDuelRoom } from '@/lib/guess-song-duel-service'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { roomId } = await params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const room = await joinDuelRoom(guard.user.id, roomId, { password: body?.password, inviteToken: body?.inviteToken })
    await duelRealtimeHub.broadcastRoom(roomId, room)
    return duelOk({ room })
  } catch (error) {
    return duelError(error, 'Unable to join duel room')
  }
}
