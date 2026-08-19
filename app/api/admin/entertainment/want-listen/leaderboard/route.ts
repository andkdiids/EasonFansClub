import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'
import {
  clearWantListenAdminLeaderboard,
  findWantListenLeaderboardUser,
  getWantListenAdminOverview,
  WantListenAdminLeaderboardError,
} from '@/lib/want-listen-admin-leaderboard'
import { wantListenError, wantListenOk } from '@/lib/want-listen-api'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

function handleAdminLeaderboardError(error: unknown, operation: string) {
  if (error instanceof WantListenAdminLeaderboardError) {
    return wantListenError(error.message, error.status, error.code)
  }
  console.error(`[want-listen.admin-leaderboard.${operation}]`, error)
  return wantListenError('想听排行榜管理暂时不可用，请稍后再试', 500, 'SERVICE_UNAVAILABLE')
}

/** GET：排行榜总览（默认）或按 UID/昵称查询用户（?view=user&q=...） */
export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前管理员无此权限', guard.response.status)
  const params = new URL(request.url).searchParams
  try {
    if (params.get('view') === 'user') {
      return wantListenOk(await findWantListenLeaderboardUser(params.get('q') || ''))
    }
    return wantListenOk(await getWantListenAdminOverview())
  } catch (error) {
    return handleAdminLeaderboardError(error, 'get')
  }
}

/** POST：清除排行榜（CLEAR_ALL / CLEAR_MODE / CLEAR_USER），不提供直接 DELETE API */
export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return wantListenError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前管理员无此权限', guard.response.status)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    const result = await clearWantListenAdminLeaderboard({
      adminId: guard.user.id,
      adminUid: guard.user.uid,
      adminNickname: guard.user.nickname,
      adminUsername: guard.user.username,
      action: body?.action,
      mode: body?.mode,
      targetUserId: sanitizeText(body?.targetUserId, 100),
      reason: sanitizeText(body?.reason, 200),
    })
    return wantListenOk({
      ...result,
      operatedAt: new Date().toISOString(),
      admin: { uid: guard.user.uid, nickname: guard.user.nickname },
    })
  } catch (error) {
    return handleAdminLeaderboardError(error, 'clear')
  }
}
