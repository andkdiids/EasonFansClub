import type { GuessSongMode } from '@prisma/client'
import { MUSIC_AUDIO_MAX_FILE_SIZE } from '@/lib/music-upload-constraints'

export const GUESS_SONG_BASE_SCORE = 100
export const GUESS_SONG_ENDLESS_COMBO_INTERVAL = 10
export const GUESS_SONG_ENDLESS_COMBO_BONUS = 270

export const GUESS_SONG_PUBLIC_MODES = ['EASY', 'ADVANCED', 'HARD', 'EXPERT'] as const
export type GuessSongPublicMode = typeof GUESS_SONG_PUBLIC_MODES[number]

export const GUESS_SONG_MODE_CONFIG = {
  EASY: {
    label: '简单',
    durationSeconds: 7,
    maxPlayCount: 5,
    questionCount: null,
    maxWrongCount: 3,
    answerMode: 'CHOICE',
    baseScore: GUESS_SONG_BASE_SCORE,
    sessionMinutes: 60,
  },
  ADVANCED: {
    label: '进阶',
    durationSeconds: 5,
    maxPlayCount: 5,
    questionCount: null,
    maxWrongCount: 3,
    answerMode: 'CHOICE',
    baseScore: GUESS_SONG_BASE_SCORE,
    sessionMinutes: 60,
  },
  HARD: {
    label: '困难',
    durationSeconds: 3,
    maxPlayCount: 5,
    questionCount: null,
    maxWrongCount: 3,
    answerMode: 'CHOICE',
    baseScore: GUESS_SONG_BASE_SCORE,
    sessionMinutes: 60,
  },
  EXPERT: {
    label: '专家',
    durationSeconds: 7,
    maxPlayCount: 5,
    questionCount: null,
    maxWrongCount: 3,
    answerMode: 'INPUT',
    baseScore: GUESS_SONG_BASE_SCORE,
    sessionMinutes: 60,
  },
  ENDLESS: {
    label: '无尽',
    durationSeconds: 7,
    maxPlayCount: 5,
    questionCount: null,
    maxWrongCount: 3,
    answerMode: 'CHOICE',
    baseScore: GUESS_SONG_BASE_SCORE,
    sessionMinutes: 60,
  },
} as const satisfies Record<GuessSongMode, {
  label: string
  durationSeconds: number
  maxPlayCount: number
  questionCount: number | null
  maxWrongCount: number
  answerMode: 'CHOICE' | 'INPUT'
  baseScore: number
  sessionMinutes: number
}>

export const GUESS_SONG_AUDIO_DURATIONS = [2, 3, 4, 5, 6, 7] as const
export const GUESS_SONG_INITIAL_LIVES = 3
export const GUESS_SONG_ANSWER_SECONDS = 30
export const GUESS_SONG_MAX_FILE_SIZE = MUSIC_AUDIO_MAX_FILE_SIZE
export const GUESS_SONG_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/x-aac',
])

export function isGuessSongMode(value: unknown): value is GuessSongMode {
  return typeof value === 'string' && value in GUESS_SONG_MODE_CONFIG
}

export function isGuessSongPublicMode(value: unknown): value is GuessSongPublicMode {
  return typeof value === 'string' && (GUESS_SONG_PUBLIC_MODES as readonly string[]).includes(value)
}

/** ENDLESS remains a database-compatible legacy value, but is exposed as the new simple mode. */
export function toPublicGuessSongMode(mode: GuessSongMode): GuessSongPublicMode {
  return mode === 'ENDLESS' ? 'EASY' : mode
}

export function isGuessSongInfiniteMode(mode: GuessSongMode) {
  return GUESS_SONG_MODE_CONFIG[mode].questionCount === null
}

export function normalizeGuessSongAnswer(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

export function calculateGuessSongScore(input: {
  mode: GuessSongMode
  playCount: number
  streak: number
  durationSeconds: number
  correct: boolean
}) {
  if (!input.correct) return 0
  const comboBonus = (input.mode === 'EASY' || input.mode === 'ENDLESS')
    && input.streak > 0
    && input.streak % GUESS_SONG_ENDLESS_COMBO_INTERVAL === 0
    ? GUESS_SONG_ENDLESS_COMBO_BONUS
    : 0
  return GUESS_SONG_BASE_SCORE + comboBonus
}
