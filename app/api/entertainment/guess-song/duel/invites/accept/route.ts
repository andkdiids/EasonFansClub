import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { acceptDuelInvite } from '@/lib/guess-song-duel-service'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    return duelOk({ room: await acceptDuelInvite(guard.user.id, body?.inviteToken) })
  } catch (error) {
    return duelError(error, 'This duel invitation is no longer available')
  }
}
