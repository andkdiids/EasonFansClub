import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'
import { answerGuessSongQuestion } from '@/lib/guess-song-session'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

type Context = { params: Promise<{ sessionId: string }> }

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'guess-song-answer', 40, 60)
  if (limit.limited) return guessSongError('答题请求过于频繁，请稍后再试', 429)
  const { sessionId } = await params
  const body = await request.json().catch(() => null) as {
    questionId?: unknown
    optionKey?: unknown
    songId?: unknown
    answerText?: unknown
  } | null
  try {
    return guessSongOk(await answerGuessSongQuestion({
      userId: guard.user.id,
      sessionId,
      publicQuestionId: sanitizeText(body?.questionId, 100),
      optionKey: body?.optionKey === null ? null : sanitizeText(body?.optionKey, 100),
      songId: sanitizeText(body?.songId, 100) || null,
      answerText: sanitizeText(body?.answerText, 160) || null,
    }))
  } catch (error) {
    return handleGuessSongError(error, 'sessions.answer')
  }
}
