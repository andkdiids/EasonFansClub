import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { updateUndercoverRoomDifficulty } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'
import { undercoverRealtimeHub } from '@/lib/undercover-star-realtime'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { roomId } = await params
  const body = await request.json().catch(() => null) as { difficulty?: unknown } | null
  try {
    const difficulty = await updateUndercoverRoomDifficulty(guard.user.id, roomId, body?.difficulty)
    await undercoverRealtimeHub.broadcastRoom(roomId)
    return undercoverOk({ difficulty })
  } catch (error) {
    return undercoverError(error, '修改难度失败。')
  }
}
