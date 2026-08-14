import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { joinDuelRoom } from '@/lib/guess-song-duel-service'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

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
    return duelOk({ room: await joinDuelRoom(guard.user.id, roomId, { password: body?.password, inviteToken: body?.inviteToken }) })
  } catch (error) {
    return duelError(error, 'Unable to join duel room')
  }
}
