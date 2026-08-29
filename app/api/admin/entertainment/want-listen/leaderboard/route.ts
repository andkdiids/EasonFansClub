import { rejectInvalidRequestOrigin, requireAdmin, sanitizeText } from '@/lib/security'
import {
  clearWantListenAdminLeaderboard,
  deleteWantListenUserScore,
  findWantListenLeaderboardUser,
  getWantListenAdminOverview,
  listRecoverableWantListenSessions,
  listWantListenAdminLeaderboard,
  previewOrApplyWantListenBackfill,
  readWantListenAdminSession,
  WantListenAdminLeaderboardError,
} from '@/lib/want-listen-admin-leaderboard'
import { wantListenError, wantListenOk } from '@/lib/want-listen-api'
import { WantListenPeriodError } from '@/lib/want-listen-period'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

function handleAdminLeaderboardError(error: unknown, operation: string) {
  if (error instanceof WantListenAdminLeaderboardError) {
    return wantListenError(error.message, error.status, error.code)
  }
  if (error instanceof WantListenPeriodError) {
    return wantListenError(error.message, error.status, error.code)
  }
  console.error(`[want-listen.admin-leaderboard.${operation}]`, error)
  return wantListenError('想听排行榜管理暂时不可用，请稍后再试', 500, 'SERVICE_UNAVAILABLE')
}

/** GET：总览（默认）| 按 UID/昵称查用户（view=user）| 补录榜单行（view=rows）| 读取游戏记录（view=session）| 可恢复记录（view=recoverable） */
export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前管理员无此权限', guard.response.status)
  const params = new URL(request.url).searchParams
  try {
    if (params.get('view') === 'user') {
      return wantListenOk(await findWantListenLeaderboardUser(params.get('q') || ''))
    }
    if (params.get('view') === 'rows') {
      return wantListenOk(await listWantListenAdminLeaderboard({
        mode: params.get('mode'),
        period: params.get('period'),
        query: params.get('q') || '',
      }))
    }
    if (params.get('view') === 'session') {
      return wantListenOk(await readWantListenAdminSession(params.get('sessionId') || ''))
    }
    if (params.get('view') === 'recoverable') {
      return wantListenOk(await listRecoverableWantListenSessions(params.get('userId') || '', params.get('mode')))
    }
    return wantListenOk(await getWantListenAdminOverview())
  } catch (error) {
    return handleAdminLeaderboardError(error, 'get')
  }
}

/** POST：清除排行榜（CLEAR_ALL / CLEAR_MODE / CLEAR_USER）、删除单条成绩（DELETE_SCORE）或补录成绩（PREVIEW_BACKFILL 预览 / BACKFILL 确认） */
export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return wantListenError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前管理员无此权限', guard.response.status)
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  try {
    if (body?.action === 'PREVIEW_BACKFILL' || body?.action === 'BACKFILL') {
      const result = await previewOrApplyWantListenBackfill({
        adminId: guard.user.id,
        userId: sanitizeText(body.userId, 100),
        mode: body.mode,
        type: body.type,
        sessionId: sanitizeText(body.sessionId, 100),
        correctDelta: body.correctDelta,
        wrongDelta: body.wrongDelta,
        startingStreak: body.startingStreak,
        playedAt: body.playedAt,
        reason: sanitizeText(body.reason, 200),
        dryRun: body.action === 'PREVIEW_BACKFILL',
      })
      return wantListenOk({
        ...result,
        operatedAt: new Date().toISOString(),
        admin: { uid: guard.user.uid, nickname: guard.user.nickname },
      })
    }
    if (body?.action === 'DELETE_SCORE') {
      const result = await deleteWantListenUserScore({
        adminId: guard.user.id,
        userId: sanitizeText(body.userId, 100),
        mode: body.mode,
        sessionId: sanitizeText(body.sessionId, 100),
        reason: sanitizeText(body.reason, 200),
      })
      return wantListenOk({
        ...result,
        operatedAt: new Date().toISOString(),
        admin: { uid: guard.user.uid, nickname: guard.user.nickname },
      })
    }
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
    return handleAdminLeaderboardError(error, 'post')
  }
}

/** DELETE：精确删除某用户的单条排行榜成绩（复用 POST 的 DELETE_SCORE 鉴权与逻辑） */
export async function DELETE(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return wantListenError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return wantListenError('当前管理员无此权限', guard.response.status)
  const params = new URL(request.url).searchParams
  try {
    const result = await deleteWantListenUserScore({
      adminId: guard.user.id,
      userId: sanitizeText(params.get('userId') || '', 100),
      mode: params.get('mode'),
      sessionId: sanitizeText(params.get('sessionId') || '', 100),
      reason: sanitizeText(params.get('reason') || '', 200),
    })
    return wantListenOk({
      ...result,
      operatedAt: new Date().toISOString(),
      admin: { uid: guard.user.uid, nickname: guard.user.nickname },
    })
  } catch (error) {
    return handleAdminLeaderboardError(error, 'delete')
  }
}
