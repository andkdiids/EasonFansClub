import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { createOrResumeGuessSongSession, getGuessSongLobbySummary, getGuessSongSessionState, startNewGuessSongSession } from '@/lib/guess-song-session'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { GuessSongRiskService, normalizeClientFlowNonce } from '@/lib/guess-song-risk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  try {
    return guessSongOk(await getGuessSongLobbySummary(guard.user.id))
  } catch (error) {
    return handleGuessSongError(error, 'sessions.summary')
  }
}

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'guess-song-session-create', 5, 60)
  if (limit.limited) return guessSongError('创建场次过于频繁，请稍后再试', 429)
  const body = await request.json().catch(() => null) as { mode?: unknown; clientFlowNonce?: unknown; replacePausedSessionId?: unknown } | null
  try {
    const result = body?.replacePausedSessionId
      ? await startNewGuessSongSession(guard.user.id, body.mode, body.replacePausedSessionId)
      : await createOrResumeGuessSongSession(guard.user.id, body?.mode)
    const risk = await GuessSongRiskService.assess({
      userId: guard.user.id,
      sessionId: result.session.id,
      trigger: 'SESSION',
      clientFlowComplete: Boolean(normalizeClientFlowNonce(body?.clientFlowNonce)),
    })
    if (risk.cheatDetected) {
      return guessSongOk({
        ...result,
        session: await getGuessSongSessionState(guard.user.id, result.session.id),
        cheatDetected: true,
        exitAfterSeconds: risk.exitAfterSeconds,
      }, 201)
    }
    return guessSongOk(result, 201)
  } catch (error) {
    return handleGuessSongError(error, 'sessions.create')
  }
}
