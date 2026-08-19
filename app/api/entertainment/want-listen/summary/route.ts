import { requireUser } from '@/lib/security'
import { getWantListenSummary } from '@/lib/want-listen'
import { handleWantListenError, wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return wantListenError('请先登录', guard.response.status)
  try {
    return wantListenOk(await getWantListenSummary(guard.user.id))
  } catch (error) {
    return handleWantListenError(error, 'summary', { operation: 'summary', userId: guard.user.id })
  }
}
