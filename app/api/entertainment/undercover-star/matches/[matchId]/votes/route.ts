import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { submitUndercoverVote } from '@/lib/undercover-star'
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
  const limit = await consumeRateLimit(guard.user.id, 'undercover-star-vote', 40, 60)
  if (limit.limited) return undercoverInputError('操作过于频繁，请稍后再试。', 'RATE_LIMITED', 429)
  const body = await request.json().catch(() => null) as { targetId?: unknown; abstain?: unknown; expectedRevision?: unknown; expectedRound?: unknown } | null
  try {
    const { matchId } = await params
    const state = await submitUndercoverVote(guard.user.id, matchId, {
      targetId: readUndercoverString(body?.targetId, 100),
      abstain: body?.abstain === true,
      expectedRevision: readUndercoverInteger(body?.expectedRevision),
      expectedRound: readUndercoverInteger(body?.expectedRound),
    })
    // 业务 mutation 已成功，HTTP 必须返回成功。realtime 广播失败（best-effort）
    // 不得把已经成功的投票变成 500，否则客户端会误报“提交失败”。
    try {
      undercoverRealtimeHub.broadcastMatchState(matchId)
      await undercoverRealtimeHub.broadcastRoom(state.snapshot.roomId)
      undercoverRealtimeHub.scheduleMatch(matchId, state.snapshot.phaseDeadline)
    } catch (broadcastError) {
      console.error('[undercover-star.broadcast] vote', broadcastError)
    }
    return undercoverOk(state)
  } catch (error) {
    return undercoverError(error, '提交投票失败。')
  }
}
