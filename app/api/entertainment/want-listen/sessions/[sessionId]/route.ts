import { requireUser } from '@/lib/security'
import { getWantListenSessionState } from '@/lib/want-listen'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  const { sessionId } = await params
  try {
    return wantListenOk(await getWantListenSessionState(guard.user.id, sessionId))
  } catch (error) {
    return handleWantListenError(error, 'sessions.get')
  }
}
