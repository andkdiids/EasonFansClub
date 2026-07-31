import type { GuessSongQuizConfig } from '@prisma/client'
import { generateGuessSongAudioFromMusicSong } from '@/lib/guess-song-admin-audio'
import { pickGuessSongDistractors, type DistractorSong } from '@/lib/guess-song-distractors'
import {
  getGuessSongQuizConfigOrDefault,
  getOrCreateGuessSongQuizConfig,
  GUESS_SONG_QUESTION_TYPE_AUTO,
} from '@/lib/guess-song-quiz-config'
import { prisma } from '@/lib/prisma'

const AUTO_POOL_SELECT = {
  id: true,
  title: true,
  albumId: true,
  releaseYear: true,
  sourceAudioPath: true,
  sourceAudioRevision: true,
  MusicAlbum: { 
    select: { 
      name: true, 
      status: true 
    } 
  },
} as const

function autoPoolWhere(config: Pick<GuessSongQuizConfig, 'sourceType' | 'albumId' | 'year'>) {
  return {
    sourceAudioPath: { not: null },
    sourceAudioRevision: { not: null },
    MusicAlbum: {
      status: 'PUBLISHED' as const,
      ...(config.sourceType === 'ALBUM' && config.albumId ? { id: config.albumId } : {}),
    },
    ...(config.sourceType === 'YEAR' && config.year ? { releaseYear: config.year } : {}),
  }
}

/** Scope filter without the publication requirement: questions may be created
    while the album is still a draft; the game pool filters them at play time. */
function autoScopeWhere(config: Pick<GuessSongQuizConfig, 'sourceType' | 'albumId' | 'year'>) {
  return {
    sourceAudioPath: { not: null },
    sourceAudioRevision: { not: null },
    ...(config.sourceType === 'ALBUM' && config.albumId ? { MusicAlbum: { id: config.albumId } } : {}),
    ...(config.sourceType === 'YEAR' && config.year ? { releaseYear: config.year } : {}),
  }
}

async function loadAutoPool(config: Pick<GuessSongQuizConfig, 'sourceType' | 'albumId' | 'year'>) {
  const songs = await prisma.musicSong.findMany({
    where: autoPoolWhere(config),
    select: AUTO_POOL_SELECT,
    orderBy: [{ releaseYear: 'desc' }, { trackNumber: 'asc' }],
    take: 2000,
  })
  return songs
}

type AutoSong = Awaited<ReturnType<typeof loadAutoPool>>[number]

function toDistractorSong(song: AutoSong): DistractorSong {
  return { id: song.id, title: song.title, albumId: song.albumId, releaseYear: song.releaseYear }
}

async function createAutoQuestionForPoolSong(
  song: AutoSong,
  pool: readonly AutoSong[],
  config: Pick<GuessSongQuizConfig, 'difficulty'>,
) {
  const distractors = pickGuessSongDistractors(toDistractorSong(song), pool.map(toDistractorSong))
  if (distractors.length < 3) return { created: false as const, reason: 'POOL_TOO_SMALL' }
  const question = await prisma.guessSongQuestion.create({
    data: {
      songTitle: song.title,
      albumTitle: song.MusicAlbum.name,
      difficulty: config.difficulty,
      enabled: false,
      allowEndless: true,
      correctAnswer: song.title,
      wrongOption1: distractors[0],
      wrongOption2: distractors[1],
      wrongOption3: distractors[2],
      musicSongId: song.id,
      questionType: GUESS_SONG_QUESTION_TYPE_AUTO,
    },
    select: { id: true },
  })
  await generateGuessSongAudioFromMusicSong(question.id)
  await prisma.guessSongQuestion.update({ where: { id: question.id }, data: { enabled: true } })
  return { created: true as const, questionId: question.id }
}

/**
 * Called after an EasMusic song audio source is (re)uploaded: the song becomes
 * an auto quiz question without any manual work. Existing questions (AUTO or
 * MANUAL) for the same song are left untouched — a stale AUTO clip is rebuilt.
 */
export async function ensureAutoQuestionForSong(songId: string) {
  const config = await getGuessSongQuizConfigOrDefault()
  if (!config.enabled) return { created: false as const, reason: 'AUTO_DISABLED' }
  const song = await prisma.musicSong.findUnique({ where: { id: songId }, select: AUTO_POOL_SELECT })
  if (!song?.sourceAudioRevision) return { created: false as const, reason: 'NO_AUDIO_SOURCE' }
  const inScope = await prisma.musicSong.count({ where: { id: songId, ...autoScopeWhere(config) } })
  if (!inScope) return { created: false as const, reason: 'NOT_IN_SOURCE_SCOPE' }

  const pool = await loadAutoPool(config)
  const existing = await prisma.guessSongQuestion.findFirst({
    where: { musicSongId: songId, questionType: GUESS_SONG_QUESTION_TYPE_AUTO },
    select: { id: true, musicSourceRevision: true },
  })
  if (existing) {
    if (existing.musicSourceRevision === song.sourceAudioRevision) return { created: false as const, reason: 'EXISTS' }
    await generateGuessSongAudioFromMusicSong(existing.id)
    await prisma.guessSongQuestion.update({ where: { id: existing.id }, data: { enabled: true } })
    return { created: true as const, questionId: existing.id, regenerated: true }
  }
  const poolSong = pool.find((item) => item.id === songId) ?? song
  return createAutoQuestionForPoolSong(poolSong, pool, config)
}

/** Backfill AUTO questions for library songs that do not have one yet. */
export async function syncAutoGuessQuestions(limit = 10) {
  const config = await getOrCreateGuessSongQuizConfig()
  const pool = await loadAutoPool(config)
  if (!config.enabled) {
    return { enabled: false as const, created: 0, failed: 0, remaining: 0, total: pool.length }
  }
  const existing = await prisma.guessSongQuestion.findMany({
    where: { questionType: GUESS_SONG_QUESTION_TYPE_AUTO, musicSongId: { in: pool.map((song) => song.id) } },
    select: { musicSongId: true },
  })
  const hasQuestion = new Set(existing.map((item) => item.musicSongId))
  const missing = pool.filter((song) => !hasQuestion.has(song.id))
  const batch = missing.slice(0, Math.max(1, Math.min(50, limit)))
  let created = 0
  let failed = 0
  const errors: string[] = []
  for (const song of batch) {
    try {
      const result = await createAutoQuestionForPoolSong(song, pool, config)
      if (result.created) created += 1
      else failed += 1
      if (!result.created) errors.push(`${song.title}: ${result.reason}`)
    } catch (error) {
      failed += 1
      errors.push(`${song.title}: ${error instanceof Error ? error.message.slice(0, 120) : '生成失败'}`)
    }
  }
  return {
    enabled: true as const,
    created,
    failed,
    remaining: missing.length - batch.length,
    total: pool.length,
    errors: errors.slice(0, 5),
  }
}
