import type { GuessSongDifficulty } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseGuessSongQuestionInput } from '@/lib/guess-song-questions'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const params = new URL(request.url).searchParams
  const query = params.get('q')?.trim().slice(0, 80) || ''
  const rawDifficulty = params.get('difficulty')
  const difficulty = ['EASY', 'ADVANCED', 'HARD'].includes(rawDifficulty || '')
    ? rawDifficulty as GuessSongDifficulty
    : null
  const enabled = params.get('enabled')

  try {
    const [questions, musicSongs] = await Promise.all([
      prisma.guessSongQuestion.findMany({
        where: {
          ...(query ? { songTitle: { contains: query, mode: 'insensitive' } } : {}),
          ...(difficulty ? { difficulty } : {}),
          ...(enabled === 'true' ? { enabled: true } : enabled === 'false' ? { enabled: false } : {}),
        },
        include: {
          musicSong: { select: { id: true, title: true, album: { select: { name: true } } } },
          audioVariants: { orderBy: { durationSeconds: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.musicSong.findMany({
        select: { id: true, title: true, album: { select: { name: true } } },
        orderBy: [{ title: 'asc' }],
        take: 1000,
      }),
    ])
    return guessSongOk({ questions, musicSongs })
  } catch (error) {
    return handleGuessSongError(error, 'admin.questions.list')
  }
}

export async function POST(request: Request) {
  if (rejectInvalidRequestOrigin(request)) return guessSongError('请求来源校验失败，请刷新后重试', 403)
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guessSongError('当前账号没有题库管理权限', guard.response.status)
  const parsed = parseGuessSongQuestionInput(await request.json().catch(() => null))
  if (!parsed.ok) return guessSongError(parsed.error, 400)
  if (parsed.data.enabled) return guessSongError('请先上传并处理音频，再启用题目', 409)

  try {
    if (parsed.data.musicSongId) {
      const song = await prisma.musicSong.findUnique({ where: { id: parsed.data.musicSongId }, select: { id: true } })
      if (!song) return guessSongError('关联的 EasMusic 歌曲不存在', 400)
    }
    const question = await prisma.guessSongQuestion.create({
      data: parsed.data,
      include: { audioVariants: true, musicSong: true },
    })
    return guessSongOk({ question }, 201)
  } catch (error) {
    return handleGuessSongError(error, 'admin.questions.create')
  }
}
