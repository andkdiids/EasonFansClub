import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { createWantListenSession, getWantListenSummary } from '@/lib/want-listen'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  try {
    return wantListenOk(await getWantListenSummary(guard.user.id))
  } catch (error) {
    return handleWantListenError(error, 'sessions.summary')
  }
}

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'want-listen-session-create', 5, 60)
  if (limit.limited) return wantListenError('创建游戏过于频繁，请稍后再试。', 429, 'RATE_LIMITED')
  const body = await request.json().catch(() => null) as { mode?: unknown } | null
  try {
    return wantListenOk(await createWantListenSession(guard.user.id, body?.mode), 201)
  } catch (error) {
    return handleWantListenError(error, 'sessions.create')
  }
}
