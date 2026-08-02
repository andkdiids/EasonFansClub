import { GUESS_SONG_AUDIO_DURATIONS } from '@/lib/guess-song-config'
import {
  createGuessSongSignedUrl,
  getGuessSongSignedUrlExpires,
} from '@/lib/guess-song-storage'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

type Context = { params: Promise<{ questionId: string }> }

export const runtime = 'nodejs'

export async function GET(request: Request, { params }: Context) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const { questionId } = await params
  const duration = Number(new URL(request.url).searchParams.get('duration'))
  if (!GUESS_SONG_AUDIO_DURATIONS.includes(duration as typeof GUESS_SONG_AUDIO_DURATIONS[number])) {
    return guessSongError('试听时长无效', 400)
  }
  try {
    const variant = await prisma.guessSongAudioVariant.findUnique({
      where: { questionId_durationSeconds_purpose: { questionId, durationSeconds: duration, purpose: 'GAME' } },
      select: { storagePath: true },
    })
    if (!variant) return guessSongError('该音频变体不存在', 404)
    const expiresIn = getGuessSongSignedUrlExpires()
    return guessSongOk({
      signedUrl: await createGuessSongSignedUrl(variant.storagePath, expiresIn),
      durationSeconds: duration,
      expiresIn,
    })
  } catch (error) {
    return handleGuessSongError(error, 'admin.audio.preview')
  }
}
