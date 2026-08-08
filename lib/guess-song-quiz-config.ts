import type { GuessSongDifficulty, GuessSongQuizConfig } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const GUESS_SONG_QUIZ_CONFIG_ID = 'global'
export const GUESS_SONG_QUESTION_TYPE_AUTO = 'AUTO'
export const GUESS_SONG_QUESTION_TYPE_MANUAL = 'MANUAL'

const DEFAULT_CONFIG = {
  enabled: true,
  expertEnabled: true,
  sourceType: 'ALL',
  albumId: null,
  year: null,
  difficulty: 'EASY' as GuessSongDifficulty,
  questionCount: 10,
}

/** Read-only config access for game paths: a missing row means defaults, no writes. */
export async function getGuessSongQuizConfigOrDefault() {
  const existing = await prisma.guessSongQuizConfig
    .findUnique({ where: { id: GUESS_SONG_QUIZ_CONFIG_ID } })
    .catch(() => null)
  return existing ?? { id: GUESS_SONG_QUIZ_CONFIG_ID, ...DEFAULT_CONFIG }
}

export async function getOrCreateGuessSongQuizConfig() {
  const existing = await prisma.guessSongQuizConfig.findUnique({ where: { id: GUESS_SONG_QUIZ_CONFIG_ID } })
  if (existing) return existing
  return prisma.guessSongQuizConfig.create({ data: { id: GUESS_SONG_QUIZ_CONFIG_ID } })
}

export type GuessSongQuizConfigInput =
  | { ok: true; data: Pick<GuessSongQuizConfig, 'enabled' | 'expertEnabled' | 'sourceType' | 'albumId' | 'year' | 'difficulty' | 'questionCount'> }
  | { ok: false; error: string }

export function parseGuessSongQuizConfigInput(value: unknown): GuessSongQuizConfigInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sourceType = typeof body.sourceType === 'string' ? body.sourceType : 'ALL'
  if (!['ALL', 'ALBUM', 'YEAR'].includes(sourceType)) return { ok: false, error: '题目来源无效' }
  const albumId = typeof body.albumId === 'string' && body.albumId.trim() ? body.albumId.trim().slice(0, 100) : null
  if (sourceType === 'ALBUM' && !albumId) return { ok: false, error: '请选择指定专辑' }
  const year = typeof body.year === 'number' && Number.isInteger(body.year) ? body.year : null
  if (sourceType === 'YEAR' && (!year || year < 1900 || year > 2100)) return { ok: false, error: '请输入有效年份' }
  const difficulty = ['EASY', 'ADVANCED', 'HARD'].includes(body.difficulty as string)
    ? body.difficulty as GuessSongDifficulty
    : null
  if (!difficulty) return { ok: false, error: '请选择有效难度' }
  const questionCount = typeof body.questionCount === 'number' && Number.isInteger(body.questionCount)
    ? body.questionCount
    : NaN
  if (![5, 10].includes(questionCount)) return { ok: false, error: '每局题目数量只支持 5 题或 10 题' }
  return {
    ok: true,
    data: {
      enabled: Boolean(body.enabled),
      expertEnabled: body.expertEnabled !== false,
      sourceType,
      albumId: sourceType === 'ALBUM' ? albumId : null,
      year: sourceType === 'YEAR' ? year : null,
      difficulty,
      questionCount,
    },
  }
}
