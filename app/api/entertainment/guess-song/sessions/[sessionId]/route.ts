import { requireUser } from '@/lib/security'
import { getGuessSongSessionState } from '@/lib/guess-song-session'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Context = { params: Promise<{ sessionId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const { sessionId } = await params
  try {
    return guessSongOk(await getGuessSongSessionState(guard.user.id, sessionId))
  } catch (error) {
    return handleGuessSongError(error, 'sessions.get')
  }
}
