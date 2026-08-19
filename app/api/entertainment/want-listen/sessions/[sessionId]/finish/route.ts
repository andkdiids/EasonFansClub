import { consumeRateLimit, getClientIp, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { finishWantListenSession } from '@/lib/want-listen'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const runtime = 'nodejs'

/** 无尽模式：主动结束并保存本次成绩 */
export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'want-listen-finish', 30, 60)
  if (limit.limited) return wantListenError('操作过于频繁，请稍后再试。', 429, 'RATE_LIMITED')
  const { sessionId } = await params
  try {
    return wantListenOk(await finishWantListenSession(guard.user.id, sessionId, {
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    }))
  } catch (error) {
    return handleWantListenError(error, 'sessions.finish')
  }
}
