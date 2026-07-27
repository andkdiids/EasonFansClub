import { consumeRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { createOrResumeGuessSongSession, getGuessSongLobbySummary } from '@/lib/guess-song-session'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  try {
    return guessSongOk(await getGuessSongLobbySummary(guard.user.id))
  } catch (error) {
    return handleGuessSongError(error, 'sessions.summary')
  }
}

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireUser()
  if (!guard.user) return guessSongError('请先登录', guard.response.status)
  const limit = await consumeRateLimit(guard.user.id, 'guess-song-session-create', 5, 60)
  if (limit.limited) return guessSongError('创建场次过于频繁，请稍后再试', 429)
  const body = await request.json().catch(() => null) as { mode?: unknown } | null
  try {
    return guessSongOk(await createOrResumeGuessSongSession(guard.user.id, body?.mode), 201)
  } catch (error) {
    return handleGuessSongError(error, 'sessions.create')
  }
}
