import { getGuessSongPlaybackSource } from '@/lib/guess-song-session'
import { streamProtectedGuessSongAudio } from '@/lib/protected-audio'
import { guessSongError, handleGuessSongError } from '@/lib/guess-song-api'
import { requireUser, sanitizeText } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ sessionId: string }> }

async function handle(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guessSongError('璇峰厛鐧诲綍', guard.response.status)

  const { sessionId } = await params
  const url = new URL(request.url)
  const publicQuestionId = sanitizeText(url.searchParams.get('questionId'), 100)
  const requestKey = sanitizeText(url.searchParams.get('requestKey'), 100)
  try {
    const source = await getGuessSongPlaybackSource({
      userId: guard.user.id,
      sessionId,
      publicQuestionId,
      requestKey,
    })
    return streamProtectedGuessSongAudio(request, source.storagePath)
  } catch (error) {
    return handleGuessSongError(error, 'sessions.audio')
  }
}

export async function GET(request: Request, context: Context) {
  return handle(request, context)
}

export async function HEAD(request: Request, context: Context) {
  return handle(request, context)
}
