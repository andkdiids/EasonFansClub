import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser, sanitizeText } from '@/lib/security'
import { answerWantListenQuestion } from '@/lib/want-listen'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'want-listen-answer', 60, 60)
  if (limit.limited) return wantListenError('答题请求过于频繁，请稍后再试。', 429, 'RATE_LIMITED')
  const { sessionId } = await params
  const body = await request.json().catch(() => null) as { questionId?: unknown; optionKey?: unknown } | null
  try {
    return wantListenOk(await answerWantListenQuestion({
      userId: guard.user.id,
      sessionId,
      publicQuestionId: sanitizeText(body?.questionId, 200),
      optionKey: sanitizeText(body?.optionKey, 100),
    }))
  } catch (error) {
    return handleWantListenError(error, 'sessions.answer')
  }
}
