import { generateGuessSongAudioFromMusicSong } from '@/lib/guess-song-admin-audio'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'
export const maxDuration = 180

type Context = { params: Promise<{ questionId: string }> }

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) {
    return guessSongError('请求来源校验失败，请刷新后重试', 403)
  }
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) {
    return guessSongError('当前账号没有题库管理权限', guard.response.status)
  }
  const { questionId } = await params
  try {
    const question = await generateGuessSongAudioFromMusicSong(questionId)
    const { GuessSongAudioVariant, ...questionData } = question
    return guessSongOk({
      question: { ...questionData, audioVariants: GuessSongAudioVariant.filter((variant) => variant.purpose === 'GAME') },
    })
  } catch (error) {
    return handleGuessSongError(error, 'admin.audio.from-music')
  }
}
