import { GUESS_SONG_AUDIO_DURATIONS } from '@/lib/guess-song-config'
import { prisma } from '@/lib/prisma'
import { streamProtectedGuessSongAudio } from '@/lib/protected-audio'
import { guessSongError, handleGuessSongError } from '@/lib/guess-song-api'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ questionId: string }> }

async function handle(request: Request, { params }: Context) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('褰撳墠璐﹀彿娌℃湁棰樺簱绠＄悊鏉冮檺', guard.response.status)
  const { questionId } = await params
  const duration = Number(new URL(request.url).searchParams.get('duration'))
  if (!GUESS_SONG_AUDIO_DURATIONS.includes(duration as typeof GUESS_SONG_AUDIO_DURATIONS[number])) {
    return guessSongError('璇曞惉鏃堕暱鏃犳晥', 400)
  }
  try {
    const variant = await prisma.guessSongAudioVariant.findUnique({
      where: { questionId_durationSeconds_purpose: { questionId, durationSeconds: duration, purpose: 'GAME' } },
      select: { storagePath: true },
    })
    if (!variant) return guessSongError('璇ラ煶棰戝彉浣撲笉瀛樺湪', 404)
    return streamProtectedGuessSongAudio(request, variant.storagePath)
  } catch (error) {
    return handleGuessSongError(error, 'admin.audio.preview.stream')
  }
}

export async function GET(request: Request, context: Context) {
  return handle(request, context)
}

export async function HEAD(request: Request, context: Context) {
  return handle(request, context)
}
