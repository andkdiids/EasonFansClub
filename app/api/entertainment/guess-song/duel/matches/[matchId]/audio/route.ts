import { getDuelAudioSource } from '@/lib/guess-song-duel-service'
import { streamProtectedGuessSongAudio } from '@/lib/protected-audio'
import { duelError } from '@/lib/guess-song-duel-api'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ matchId: string }> }

async function handle(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { matchId } = await params
  const publicToken = new URL(request.url).searchParams.get('questionId') || ''
  try {
    const source = await getDuelAudioSource(guard.user.id, matchId, publicToken.slice(0, 100))
    return streamProtectedGuessSongAudio(request, source.storagePath)
  } catch (error) {
    return duelError(error, 'Duel audio is not available')
  }
}
export async function GET(request: Request, context: Context) {
  return handle(request, context)
}

export async function HEAD(request: Request, context: Context) {
  return handle(request, context)
}
