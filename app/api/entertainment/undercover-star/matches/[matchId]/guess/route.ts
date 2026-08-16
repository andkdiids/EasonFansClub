import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { submitUndercoverGuess } from '@/lib/undercover-star'
import { undercoverError, undercoverInputError, undercoverOk, readUndercoverInteger, readUndercoverString } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limit = await consumeRateLimit(guard.user.id, 'undercover-star-guess', 20, 60)
  if (limit.limited) return undercoverInputError('操作过于频繁，请稍后再试。', 'RATE_LIMITED', 429)
  const body = await request.json().catch(() => null) as { guess?: unknown; expectedRevision?: unknown } | null
  try {
    const { matchId } = await params
    const state = await submitUndercoverGuess(guard.user.id, matchId, {
      guess: readUndercoverString(body?.guess, 191),
      expectedRevision: readUndercoverInteger(body?.expectedRevision),
    })
    undercoverRealtimeHub.broadcastMatchState(matchId)
    undercoverRealtimeHub.scheduleMatch(matchId, state.snapshot.phaseDeadline)
    return undercoverOk(state)
  } catch (error) {
    return undercoverError(error, '提交猜词失败。')
  }
}
