import {
  getOrCreateGuessSongQuizConfig,
  GUESS_SONG_QUESTION_TYPE_AUTO,
  GUESS_SONG_QUESTION_TYPE_MANUAL,
  parseGuessSongQuizConfigInput,
} from '@/lib/guess-song-quiz-config'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  try {
    const [config, autoCount, manualCount, poolCount] = await Promise.all([
      getOrCreateGuessSongQuizConfig(),
      prisma.guessSongQuestion.count({ where: { questionType: GUESS_SONG_QUESTION_TYPE_AUTO } }),
      prisma.guessSongQuestion.count({ where: { questionType: GUESS_SONG_QUESTION_TYPE_MANUAL } }),
      prisma.musicSong.count({
        where: { sourceAudioPath: { not: null }, sourceAudioRevision: { not: null }, MusicAlbum: { status: 'PUBLISHED' } },
      }),
    ])
    return guessSongOk({ config, stats: { autoCount, manualCount, poolCount } })
  } catch (error) {
    return handleGuessSongError(error, 'admin.quizConfig.get')
  }
}

export async function PUT(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const parsed = parseGuessSongQuizConfigInput(await request.json().catch(() => null))
  if (!parsed.ok) return guessSongError(parsed.error, 400)
  try {
    if (parsed.data.sourceType === 'ALBUM' && parsed.data.albumId) {
      const album = await prisma.musicAlbum.count({ where: { id: parsed.data.albumId } })
      if (!album) return guessSongError('指定专辑不存在', 400)
    }
    const config = await prisma.guessSongQuizConfig.upsert({
      where: { id: 'global' },
      create: { id: 'global', ...parsed.data },
      update: parsed.data,
    })
    return guessSongOk({ config })
  } catch (error) {
    return handleGuessSongError(error, 'admin.quizConfig.save')
  }
}
