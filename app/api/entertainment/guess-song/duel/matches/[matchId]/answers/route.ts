import { duelError, duelOk } from '@/lib/guess-song-duel-api'
import { submitDuelAnswer } from '@/lib/guess-song-duel-service'
import { duelRealtimeHub } from '@/lib/guess-song-duel-realtime'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { matchId } = await params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const outcome = await submitDuelAnswer({
      userId: guard.user.id,
      matchId,
      questionToken: body?.questionToken as string,
      selectedOptionKey: body?.selectedOptionKey as string,
      clientElapsedMs: body?.clientElapsedMs,
      // HTTP fallback has no server-measured RTT handshake; never trust a client-supplied compensation.
      latencyEstimateMs: 0,
    })
    await duelRealtimeHub.publishSubmission(matchId, outcome)
    return duelOk({ answer: { accepted: outcome.accepted, duplicate: outcome.duplicate, questionIndex: outcome.questionIndex } })
  } catch (error) {
    return duelError(error, 'Unable to submit duel answer')
  }
}
