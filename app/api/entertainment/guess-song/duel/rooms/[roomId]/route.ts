import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { getDuelRoomState } from '@/lib/guess-song-duel-service'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { roomId } = await params
  try {
    return duelOk({ room: await getDuelRoomState(roomId) })
  } catch (error) {
    return duelError(error, 'Unable to load duel room')
  }
}
