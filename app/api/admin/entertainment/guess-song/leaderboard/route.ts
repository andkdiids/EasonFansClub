import { requireAdmin, rejectInvalidRequestOrigin, sanitizeText } from '@/lib/security'
import {
  addGuessSongAdminScore,
  deleteGuessSongAdminLeaderboard,
  GuessSongAdminLeaderboardError,
  listGuessSongAdminLeaderboard,
} from '@/lib/guess-song-admin-leaderboard'
import { guessSongError, guessSongOk } from '@/lib/guess-song-api'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

function handleAdminLeaderboardError(error: unknown, operation: string) {
  if (error instanceof GuessSongAdminLeaderboardError) {
    return guessSongError(error.message, error.status, error.code)
  }
  console.error(`[guess-song.admin-leaderboard.${operation}]`, error)
  return guessSongError('听听排行榜管理暂时不可用，请稍后再试', 500, 'SERVICE_UNAVAILABLE')
}

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有听听排行榜管理权限', guard.response.status)
  const params = new URL(request.url).searchParams
  try {
    const response = guessSongOk(await listGuessSongAdminLeaderboard({
      mode: params.get('mode') || 'EASY',
      periodType: params.get('period') || 'WEEK',
      periodKey: params.get('periodKey'),
      query: params.get('q') || '',
    }))
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  } catch (error) {
    return handleAdminLeaderboardError(error, 'list')
  }
}

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有听听排行榜管理权限', guard.response.status)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    if (body?.action !== 'ADD_SCORE') return guessSongError('管理操作无效', 400, 'INVALID_ACTION')
    const result = await addGuessSongAdminScore({
      adminId: guard.user.id,
      userId: sanitizeText(body?.userId, 100),
      mode: body?.mode,
      periodType: body?.periodType,
      periodKey: sanitizeText(body?.periodKey, 20) || null,
      correctAnswers: body?.correctAnswers,
      startingStreak: body?.startingStreak,
      reason: sanitizeText(body?.reason, 200),
    })
    return guessSongOk(result)
  } catch (error) {
    return handleAdminLeaderboardError(error, 'add-score')
  }
}

export async function DELETE(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有听听排行榜管理权限', guard.response.status)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const result = await deleteGuessSongAdminLeaderboard({
      adminId: guard.user.id,
      userId: sanitizeText(body?.userId, 100),
      mode: body?.mode,
      periodType: body?.periodType,
      periodKey: sanitizeText(body?.periodKey, 20) || null,
      reason: sanitizeText(body?.reason, 200),
    })
    return guessSongOk(result)
  } catch (error) {
    return handleAdminLeaderboardError(error, 'delete')
  }
}
