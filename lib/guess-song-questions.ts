import type { GuessSongDifficulty, GuessSongProcessingStatus } from '@prisma/client'
import { GUESS_SONG_MODE_CONFIG } from '@/lib/guess-song-config'
import { sanitizeText } from '@/lib/security'

const difficulties: GuessSongDifficulty[] = ['EASY', 'ADVANCED', 'HARD']
const processingStatuses: GuessSongProcessingStatus[] = ['PENDING', 'PROCESSING', 'READY', 'FAILED']

export type GuessSongQuestionInput =
  | {
      ok: true
      data: {
        songTitle: string
        albumTitle: string | null
        musicSongId: string | null
        difficulty: GuessSongDifficulty
        allowEndless: boolean
        correctAnswer: string
        wrongOption1: string
        wrongOption2: string
        wrongOption3: string
        enabled: boolean
      }
    }
  | { ok: false; error: string }

export function parseGuessSongQuestionInput(value: unknown): GuessSongQuestionInput {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const songTitle = sanitizeText(body.songTitle, 160)
  const albumTitle = sanitizeText(body.albumTitle, 160) || null
  const musicSongId = sanitizeText(body.musicSongId, 100) || null
  const difficulty = difficulties.includes(body.difficulty as GuessSongDifficulty)
    ? body.difficulty as GuessSongDifficulty
    : null
  const options = [
    sanitizeText(body.correctAnswer, 160),
    sanitizeText(body.wrongOption1, 160),
    sanitizeText(body.wrongOption2, 160),
    sanitizeText(body.wrongOption3, 160),
  ]

  if (!songTitle) return { ok: false, error: '歌曲名称不能为空或仅包含空格' }
  if (!difficulty) return { ok: false, error: '请选择有效难度' }
  if (options.some((option) => !option)) return { ok: false, error: '正确答案和三个错误选项均不能为空' }
  const normalized = options.map((option) => option.toLocaleLowerCase('zh-CN'))
  if (new Set(normalized).size !== 4) return { ok: false, error: '四个答案不能重复' }

  return {
    ok: true,
    data: {
      songTitle,
      albumTitle,
      musicSongId,
      difficulty,
      allowEndless: body.allowEndless !== false,
      correctAnswer: options[0],
      wrongOption1: options[1],
      wrongOption2: options[2],
      wrongOption3: options[3],
      enabled: Boolean(body.enabled),
    },
  }
}

export function getRequiredGuessSongDurations(
  difficulty: GuessSongDifficulty,
  allowEndless: boolean,
) {
  const required = new Set<number>([GUESS_SONG_MODE_CONFIG[difficulty].durationSeconds])
  if (allowEndless) required.add(GUESS_SONG_MODE_CONFIG.ENDLESS.durationSeconds)
  return [...required].sort((left, right) => left - right)
}

export function canEnableGuessSongQuestion(input: {
  processingStatus: GuessSongProcessingStatus
  difficulty: GuessSongDifficulty
  allowEndless: boolean
  variantDurations: readonly number[]
}) {
  if (input.processingStatus !== 'READY') return false
  const available = new Set(input.variantDurations)
  return getRequiredGuessSongDurations(input.difficulty, input.allowEndless)
    .every((duration) => available.has(duration))
}

export function isGuessSongProcessingStatus(value: unknown): value is GuessSongProcessingStatus {
  return processingStatuses.includes(value as GuessSongProcessingStatus)
}
