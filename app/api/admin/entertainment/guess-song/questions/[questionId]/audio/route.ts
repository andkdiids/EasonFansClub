import path from 'node:path'
import { GUESS_SONG_AUDIO_TYPES, GUESS_SONG_MAX_FILE_SIZE } from '@/lib/guess-song-config'
import { uploadAndProcessGuessSongAudio } from '@/lib/guess-song-admin-audio'
import { detectMusicAudioType } from '@/lib/music-upload-constraints'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const runtime = 'nodejs'
type Context = { params: Promise<{ questionId: string }> }

export async function POST(request: Request, { params }: Context) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const { questionId } = await params
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return guessSongError('请选择音频文件', 400)
  const extension = path.extname(file.name).replace('.', '').toLowerCase()
  if (!GUESS_SONG_AUDIO_TYPES.has(file.type) && !['mp3', 'm4a', 'wav', 'aac'].includes(extension)) {
    return guessSongError('仅支持 MP3、M4A、WAV 或 AAC 音频', 400)
  }
  if (file.size > GUESS_SONG_MAX_FILE_SIZE) return guessSongError('音频文件不能超过 100MB', 413)

  try {
    const input = Buffer.from(await file.arrayBuffer())
    if (!detectMusicAudioType(input)) return guessSongError('音频文件内容无效或格式不受支持', 400)
    const question = await uploadAndProcessGuessSongAudio(
      questionId,
      input,
      extension || 'audio',
    )
    const { GuessSongAudioVariant, ...questionData } = question
    return guessSongOk({ question: { ...questionData, audioVariants: GuessSongAudioVariant } })
  } catch (error) {
    return handleGuessSongError(error, 'admin.audio.upload')
  }
}
