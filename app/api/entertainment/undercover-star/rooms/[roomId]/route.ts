import { requireUser } from '@/lib/security'
import { getUndercoverRoomState } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ roomId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { roomId } = await params
    return undercoverOk({ room: await getUndercoverRoomState(guard.user.id, roomId) })
  } catch (error) {
    return undercoverError(error, '暂时无法恢复房间。')
  }
}
