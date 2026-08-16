import type { UndercoverDifficulty, UndercoverMatchPhase, UndercoverRole, UndercoverWordCategory } from '@prisma/client'

export const UNDERCOVER_STAR_SLUG = 'undercover-star'
export const UNDERCOVER_MIN_PLAYERS = 3
export const UNDERCOVER_MAX_PLAYERS = 4
export const UNDERCOVER_WAITING_TTL_MS = 30 * 60 * 1000
export const UNDERCOVER_ROLE_REVEAL_MS = 45 * 1000
export const UNDERCOVER_DESCRIPTION_MS = 60 * 1000
export const UNDERCOVER_VOTING_MS = 45 * 1000
export const UNDERCOVER_GUESS_MS = 30 * 1000
export const UNDERCOVER_ONLINE_WINDOW_MS = 75 * 1000
export const UNDERCOVER_MAX_WORD_LENGTH = 80
export const UNDERCOVER_MAX_DESCRIPTION_LENGTH = 30

export const UNDERCOVER_SETTING_KEYS = {
  enabled: 'entertainment.undercover-star.enabled',
} as const

export const undercoverDifficultyLabels: Record<UndercoverDifficulty, string> = {
  EASY: '简单',
  NORMAL: '普通',
  HARD: '困难',
}

export const undercoverCategoryLabels: Record<UndercoverWordCategory, string> = {
  SONG: '歌曲',
  ALBUM: '专辑',
  EASON_RELATED: 'Eason 相关',
  GENERAL: '普通',
}

export const undercoverRoleLabels: Record<UndercoverRole, string> = {
  CIVILIAN: '平民',
  UNDERCOVER: '卧底',
}

export const undercoverPhaseLabels: Record<UndercoverMatchPhase, string> = {
  ROLE_REVEAL: '查看身份',
  DESCRIBING: '描述阶段',
  VOTING: '投票阶段',
  TIE_VOTING: '平票加赛',
  UNDERCOVER_GUESS: '最后一搏',
  FINISHED: '本局结果',
}

export function isUndercoverDifficulty(value: unknown): value is UndercoverDifficulty {
  return value === 'EASY' || value === 'NORMAL' || value === 'HARD'
}

export function isUndercoverCategory(value: unknown): value is UndercoverWordCategory {
  return value === 'SONG' || value === 'ALBUM' || value === 'EASON_RELATED' || value === 'GENERAL'
}

export function isUndercoverPhase(value: unknown): value is UndercoverMatchPhase {
  return value === 'ROLE_REVEAL' || value === 'DESCRIBING' || value === 'VOTING' || value === 'TIE_VOTING' || value === 'UNDERCOVER_GUESS' || value === 'FINISHED'
}
