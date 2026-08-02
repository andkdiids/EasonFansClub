import { regenerateGuessSongAudio } from '@/lib/guess-song-admin-audio'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const runtime = 'nodejs'
type Context = { params: Promise<{ questionId: string }> }

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const { questionId } = await params
  try {
    const question = await regenerateGuessSongAudio(questionId)
    const { GuessSongAudioVariant, ...questionData } = question
    return guessSongOk({ question: { ...questionData, audioVariants: GuessSongAudioVariant.filter((variant) => variant.purpose === 'GAME') } })
  } catch (error) {
    return handleGuessSongError(error, 'admin.audio.regenerate')
  }
}
