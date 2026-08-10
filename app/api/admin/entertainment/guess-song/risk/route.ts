import { GuessSongRiskService } from '@/lib/guess-song-risk'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有听听风控查看权限', guard.response.status)
  const params = new URL(request.url).searchParams
  const rawLimit = Number.parseInt(params.get('limit') || '50', 10)
  const rawMinRiskScore = Number.parseInt(params.get('minRiskScore') || '0', 10)
  try {
    const response = guessSongOk({
      logs: await GuessSongRiskService.listLogs({
        limit: Number.isFinite(rawLimit) ? rawLimit : 50,
        minRiskScore: Number.isFinite(rawMinRiskScore) ? rawMinRiskScore : 0,
      }),
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    return handleGuessSongError(error, 'admin.risk.list')
  }
}
