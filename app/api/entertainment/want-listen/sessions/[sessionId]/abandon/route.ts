import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { abandonWantListenSession } from '@/lib/want-listen'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return wantListenError('请求来源校验失败，请刷新页面后重试。', 403)
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  const { sessionId } = await params
  try {
    return wantListenOk(await abandonWantListenSession(guard.user.id, sessionId))
  } catch (error) {
    return handleWantListenError(error, 'sessions.abandon')
  }
}
