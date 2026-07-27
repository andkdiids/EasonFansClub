import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'
import { requestGuessSongPlayback } from '@/lib/guess-song-session'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const runtime = 'nodejs'
type Context = { params: Promise<{ sessionId: string }> }

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'guess-song-play', 60, 60)
  if (limit.limited) return guessSongError('播放请求过于频繁，请稍后再试', 429)
  const { sessionId } = await params
  const body = await request.json().catch(() => null) as { questionId?: unknown; requestKey?: unknown } | null
  try {
    return guessSongOk(await requestGuessSongPlayback({
      userId: guard.user.id,
      sessionId,
      publicQuestionId: sanitizeText(body?.questionId, 100),
      requestKey: sanitizeText(body?.requestKey, 100),
    }))
  } catch (error) {
    return handleGuessSongError(error, 'sessions.play')
  }
}
