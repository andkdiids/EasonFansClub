import type { GuessSongMode } from '@prisma/client'
import { MUSIC_AUDIO_MAX_FILE_SIZE } from '@/lib/music-upload-constraints'

export const GUESS_SONG_MODE_CONFIG = {
  EASY: {
    label: '简单',
    durationSeconds: 7,
    maxPlayCount: 2,
    questionCount: 10,
    baseScore: 100,
    sessionMinutes: 30,
  },
  ADVANCED: {
    label: '进阶',
    durationSeconds: 4,
    maxPlayCount: 3,
    questionCount: 10,
    baseScore: 180,
    sessionMinutes: 30,
  },
  HARD: {
    label: '困难',
    durationSeconds: 2,
    maxPlayCount: 5,
    questionCount: 10,
    baseScore: 300,
    sessionMinutes: 30,
  },
  ENDLESS: {
    label: '无尽',
    durationSeconds: null,
    maxPlayCount: 5,
    questionCount: null,
    baseScore: 120,
    sessionMinutes: 60,
  },
} as const satisfies Record<GuessSongMode, {
  label: string
  durationSeconds: number | null
  maxPlayCount: number
  questionCount: number | null
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

export function getPlaybackRatio(playCount: number) {
  return [1, 0.9, 0.8, 0.7, 0.6][Math.max(1, Math.min(5, playCount)) - 1] ?? 0.6
}

export function getStreakMultiplier(streak: number) {
  if (streak >= 10) return 2
  if (streak >= 6) return 1.5
  if (streak >= 3) return 1.2
  return 1
}

export function getEndlessDurationMultiplier(durationSeconds: number) {
  if (durationSeconds <= 2) return 2.5
  if (durationSeconds === 3) return 2
  if (durationSeconds === 4) return 1.5
  if (durationSeconds === 5) return 1.2
  return 1
}

export function calculateGuessSongScore(input: {
  mode: GuessSongMode
  playCount: number
  streak: number
  durationSeconds: number
  correct: boolean
}) {
  if (!input.correct) return 0
  const config = GUESS_SONG_MODE_CONFIG[input.mode]
  const durationMultiplier = input.mode === 'ENDLESS'
    ? getEndlessDurationMultiplier(input.durationSeconds)
    : 1
  return Math.round(
    config.baseScore
    * getPlaybackRatio(input.playCount)
    * getStreakMultiplier(input.streak)
    * durationMultiplier,
  )
}
