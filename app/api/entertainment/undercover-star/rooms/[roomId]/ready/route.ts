import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { getUndercoverRoomState, setUndercoverReady } from '@/lib/undercover-star'
import { undercoverError, undercoverInputError, undercoverOk } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limit = await consumeRateLimit(guard.user.id, 'undercover-star-ready', 30, 60)
  if (limit.limited) return undercoverInputError('操作过于频繁，请稍后再试。', 'RATE_LIMITED', 429)
  const body = await request.json().catch(() => null) as { ready?: unknown } | null
  try {
    const { roomId } = await params
    if (typeof body?.ready !== 'boolean') return undercoverInputError('准备状态无效。', 'READY_INVALID', 400)
    await setUndercoverReady(guard.user.id, roomId, body.ready)
    // 业务 mutation 已成功，HTTP 必须返回成功；广播失败不得影响业务结果。
    try {
      await undercoverRealtimeHub.broadcastRoom(roomId)
    } catch (broadcastError) {
      console.error('[undercover-star.broadcast] ready', broadcastError)
    }
    return undercoverOk({ room: await getUndercoverRoomState(guard.user.id, roomId) })
  } catch (error) {
    return undercoverError(error, '更新准备状态失败。')
  }
}
