import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { resumeGuessSongSession } from '@/lib/guess-song-session'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

type Context = { params: Promise<{ sessionId: string }> }

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const { sessionId } = await params
  try {
    return guessSongOk(await resumeGuessSongSession(guard.user.id, sessionId))
  } catch (error) {
    return handleGuessSongError(error, 'sessions.resume')
  }
}
