import type { GuessSongDifficulty } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { toPublicMediaUrl } from '@/lib/media-url'
import { parseGuessSongQuestionInput } from '@/lib/guess-song-questions'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { guessSongError, guessSongOk, handleGuessSongError } from '@/lib/guess-song-api'

export const dynamic = 'force-dynamic'
export const revalidate = 0
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
          ...(query ? { songTitle: { contains: query } } : {}),
          ...(difficulty ? { difficulty } : {}),
          ...(enabled === 'true' ? { enabled: true } : enabled === 'false' ? { enabled: false } : {}),
        },
        include: {
          MusicSong: {
            select: {
              id: true,
              title: true,
              sourceAudioRevision: true,
              MusicAlbum: { select: { name: true, coverUrl: true } },
            },
          },
          GuessSongAudioVariant: { where: { purpose: 'GAME' }, orderBy: { durationSeconds: 'asc' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      prisma.musicSong.findMany({
        select: {
          id: true,
          title: true,
          artist: true,
          trackNumber: true,
          releaseYear: true,
          coverUrl: true,
          previewUrl: true,
          expertEnabled: true,
          sourceAudioPath: true,
          sourceAudioRevision: true,
          MusicAlbum: {
            select: {
              id: true,
              name: true,
              artist: true,
              releaseYear: true,
              coverUrl: true,
            },
          },
          _count: { select: { GuessSongQuestion: true } },
        },
        orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }],
        take: 1000,
      }),
    ])
    const response = guessSongOk({
      questions: questions.map(({ GuessSongAudioVariant, MusicSong, ...question }) => ({
        ...question,
        musicSong: MusicSong
          ? { id: MusicSong.id, title: MusicSong.title, album: { ...MusicSong.MusicAlbum, coverUrl: toPublicMediaUrl(MusicSong.MusicAlbum.coverUrl) } }
          : null,
        sourceStale: Boolean(
          question.audioSourceType === 'EASMUSIC_SONG'
          && MusicSong?.sourceAudioRevision
          && question.musicSourceRevision !== MusicSong.sourceAudioRevision
        ),
        audioVariants: GuessSongAudioVariant,
      })),
      musicSongs: musicSongs.map(({ MusicAlbum, sourceAudioPath, _count, ...song }) => ({
        ...song,
        coverUrl: toPublicMediaUrl(song.coverUrl),
        previewUrl: toPublicMediaUrl(song.previewUrl),
        hasAudioSource: Boolean(sourceAudioPath),
        hasGuessClip: _count.GuessSongQuestion > 0,
        album: { ...MusicAlbum, coverUrl: toPublicMediaUrl(MusicAlbum.coverUrl) },
      })),
    })
    response.headers.set('Cache-Control', 'private, no-store')
    return response
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
      include: { GuessSongAudioVariant: true, MusicSong: true },
    })
    const { GuessSongAudioVariant, ...questionData } = question
    return guessSongOk({ question: { ...questionData, audioVariants: GuessSongAudioVariant } }, 201)
  } catch (error) {
    return handleGuessSongError(error, 'admin.questions.create')
  }
}
