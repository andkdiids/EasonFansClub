import type { GuessSongMode } from '@prisma/client'
import { MUSIC_AUDIO_MAX_FILE_SIZE } from '@/lib/music-upload-constraints'

export const GUESS_SONG_BASE_SCORE = 100
export const GUESS_SONG_ENDLESS_COMBO_INTERVAL = 10
export const GUESS_SONG_ENDLESS_COMBO_BONUS = 270
export const GUESS_SONG_PAUSED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const GUESS_SONG_ADMIN_MAX_BONUS_CORRECT_ANSWERS = 1000

export const GUESS_SONG_PUBLIC_MODES = ['EASY', 'ADVANCED', 'HARD', 'EXPERT'] as const
export type GuessSongPublicMode = typeof GUESS_SONG_PUBLIC_MODES[number]
export const GUESS_SONG_SIMPLE_MODE: GuessSongPublicMode = 'EASY'

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

/** Returns the database values represented by one public mode. */
export function getGuessSongDatabaseModes(mode: GuessSongPublicMode): GuessSongMode[] {
  return mode === GUESS_SONG_SIMPLE_MODE ? ['EASY', 'ENDLESS'] : [mode]
}

/** ENDLESS remains a database-compatible legacy value, but is exposed as the new simple mode. */
export function toPublicGuessSongMode(mode: GuessSongMode): GuessSongPublicMode {
  return mode === 'ENDLESS' ? 'EASY' : mode
}

export function isGuessSongInfiniteMode(mode: GuessSongMode) {
  return GUESS_SONG_MODE_CONFIG[mode].questionCount === null
}

const guessSongVersionMarker = '(?:\\b(?:live|acoustic|remix|demo)(?:\\s+version|版)?(?![A-Za-z])|\\bstudio\\s+version\\b|\\bremastered\\b|现场(?:版)?|演唱会(?:版)?|国语版|粤语版|双语版)'
const guessSongVersionYear = '(?:19|20)\\d{2}'
const guessSongSeparator = '[\\s\\-_–—_/·:：|,，]+'
const bracketedGuessSongVersionSuffix = new RegExp(
  `(?:\\([^()]*?(?:${guessSongVersionMarker}|${guessSongVersionYear})[^()]*\\)|\\[[^\\[\\]]*?(?:${guessSongVersionMarker}|${guessSongVersionYear})[^\\[\\]]*\\]|（[^（）]*?(?:${guessSongVersionMarker}|${guessSongVersionYear})[^（）]*）|【[^【】]*?(?:${guessSongVersionMarker}|${guessSongVersionYear})[^【】]*】)\\s*$`,
  'iu',
)
const plainGuessSongVersionSuffix = new RegExp(
  `${guessSongSeparator}(?:(?:${guessSongVersionYear}${guessSongSeparator})?${guessSongVersionMarker}(?:${guessSongSeparator}${guessSongVersionYear})?)\\s*$`,
  'iu',
)
// A bare "Title 2010" can be part of the official title (for example,
// "陈奕迅：DUO 2010"). Only strip a year when punctuation clearly marks it as
// a release/version suffix; bracketed years are handled above.
const plainGuessSongYearSuffix = new RegExp(`[\\-_–—_/·:：|,，]+\\s*${guessSongVersionYear}(?:年)?\\s*$`, 'iu')

function stripGuessSongVersionSuffix(value: string) {
  let current = value.normalize('NFKC').trim()
  let previous = ''
  while (current && current !== previous) {
    previous = current
    current = current.replace(bracketedGuessSongVersionSuffix, '').trim()
    current = current.replace(plainGuessSongVersionSuffix, '').trim()
    current = current.replace(plainGuessSongYearSuffix, '').trim()
  }
  return current
}

export function normalizeGuessSongAnswer(value: string) {
  return stripGuessSongVersionSuffix(value)
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
