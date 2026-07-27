import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { abandonGuessSongSession } from '@/lib/guess-song-session'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

type Context = { params: Promise<{ sessionId: string }> }

export const runtime = 'nodejs'

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const { sessionId } = await params
  try {
    return guessSongOk(await abandonGuessSongSession(guard.user.id, sessionId))
  } catch (error) {
    return handleGuessSongError(error, 'sessions.abandon')
  }
}
