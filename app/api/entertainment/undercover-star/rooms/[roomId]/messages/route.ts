import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { getRoomMessages, sendRoomMessage } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function GET(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { roomId } = await params
    // 非成员（含被踢/已离开）会被 service 以 ROOM_NOT_MEMBER 拒绝。
    const messages = await getRoomMessages(guard.user.id, roomId, 50)
    return undercoverOk({ messages })
  } catch (error) {
    return undercoverError(error, '读取聊天记录失败。')
  }
}

export async function POST(request: Request, { params }: Context) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { roomId } = await params
    const body = await request.json().catch(() => null) as { content?: unknown } | null
    const content = typeof body?.content === 'string' ? body.content : ''
    const message = await sendRoomMessage(guard.user.id, roomId, content)
    // DB 已成功写入即视为发送成功；广播为 best-effort，失败仅记日志，
    // 客户端可通过历史接口恢复，避免把「广播失败」伪装成「发送失败」导致重复发送。
    try {
      undercoverRealtimeHub.broadcastRoomChat(roomId, message)
    } catch (broadcastError) {
      console.error('[undercover-star.chat.broadcast]', broadcastError)
    }
    // 响应只返回公开聊天结构，绝不携带 role / word / passwordHash / 邮箱 / 手机号 / IP 等敏感字段。
    return undercoverOk({ message })
  } catch (error) {
    return undercoverError(error, '发送聊天失败。')
  }
}
