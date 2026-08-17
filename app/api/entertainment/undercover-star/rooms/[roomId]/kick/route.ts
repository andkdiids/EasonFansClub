import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { getUndercoverRoomState, kickUndercoverPlayer } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { roomId } = await params
    const body = await request.json().catch(() => null) as { userId?: unknown } | null
    const targetUserId = typeof body?.userId === 'string' ? body.userId : ''
    if (!targetUserId) return undercoverError(new Error('缺少被踢玩家。'), '缺少被踢玩家。')
    const result = await kickUndercoverPlayer(guard.user.id, roomId, targetUserId)
    // 业务 mutation 已成功，HTTP 必须返回成功；广播失败不得影响业务结果。
    // 仅被踢玩家收到 ROOM_KICKED，立即返回大厅（同步 safeSend，不会抛错）。
    try {
      if (result.affectedRoomId) await undercoverRealtimeHub.broadcastRoom(result.affectedRoomId)
      undercoverRealtimeHub.notifyRoomKicked(roomId, targetUserId)
    } catch (broadcastError) {
      console.error('[undercover-star.broadcast] kick', broadcastError)
    }
    // 响应只返回房间公共状态，绝不携带 word / role / MatchPlayer 私密数据。
    return undercoverOk({ room: await getUndercoverRoomState(guard.user.id, roomId), kicked: result.kicked })
  } catch (error) {
    return undercoverError(error, '踢出玩家失败。')
  }
}
