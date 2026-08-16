import { requireUser } from '@/lib/security'
import { getUndercoverPrivateState } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    const { matchId } = await params
    return undercoverOk({ privateState: await getUndercoverPrivateState(guard.user.id, matchId) })
  } catch (error) {
    return undercoverError(error, '暂时无法读取你的身份信息。')
  }
}
