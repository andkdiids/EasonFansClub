import { GuessSongRiskService } from '@/lib/guess-song-risk'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { enforceApiRateLimit, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有听听风控查看权限', guard.response.status)
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/entertainment/guess-song/risk',
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
  })
  if (limited) return limited
  const params = new URL(request.url).searchParams
  const parsedLimit = Number.parseInt(params.get('limit') || '50', 10)
  const parsedMinRiskScore = Number.parseInt(params.get('minRiskScore') || '0', 10)
  const rawLimit = Number.isSafeInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 50
  const rawMinRiskScore = Number.isSafeInteger(parsedMinRiskScore) ? Math.min(100, Math.max(0, parsedMinRiskScore)) : 0
  try {
    const response = guessSongOk({
      logs: await GuessSongRiskService.listLogs({
        limit: rawLimit,
        minRiskScore: rawMinRiskScore,
      }),
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    return handleGuessSongError(error, 'admin.risk.list')
  }
}
