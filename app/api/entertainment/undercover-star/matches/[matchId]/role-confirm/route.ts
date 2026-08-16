import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { confirmUndercoverRole } from '@/lib/undercover-star'
import { undercoverError, undercoverInputError, undercoverOk, readUndercoverInteger } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limit = await consumeRateLimit(guard.user.id, 'undercover-star-role-confirm', 20, 60)
  if (limit.limited) return undercoverInputError('操作过于频繁，请稍后再试。', 'RATE_LIMITED', 429)
  const body = await request.json().catch(() => null) as { expectedRevision?: unknown } | null
  try {
    const { matchId } = await params
    const state = await confirmUndercoverRole(guard.user.id, matchId, readUndercoverInteger(body?.expectedRevision))
    undercoverRealtimeHub.broadcastMatchState(matchId)
    undercoverRealtimeHub.scheduleMatch(matchId, state.snapshot.phaseDeadline)
    return undercoverOk(state)
  } catch (error) {
    return undercoverError(error, '确认身份失败。')
  }
}
