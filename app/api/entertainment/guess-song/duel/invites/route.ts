import { duelError, duelInputError, duelOk } from '@/lib/guess-song-duel-api'
import { createDuelInvite } from '@/lib/guess-song-duel-service'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (typeof body?.roomId !== 'string' || typeof body.inviteeId !== 'string') return duelInputError('房间和好友不能为空')
  try {
    return duelOk({ invite: await createDuelInvite(guard.user.id, body.roomId, body.inviteeId) })
  } catch (error) {
    return duelError(error, 'Unable to send duel invite')
  }
}
