import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { getDuelMatchState } from '@/lib/guess-song-duel-service'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { matchId } = await params
  try {
    return duelOk({ match: await getDuelMatchState(guard.user.id, matchId) })
  } catch (error) {
    return duelError(error, 'Unable to load duel match')
  }
}
