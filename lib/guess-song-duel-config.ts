export const DUEL_TOTAL_QUESTIONS = 30
export const DUEL_TARGET_CORRECT = 16
export const DUEL_AUDIO_DURATION_SECONDS = 7
export const DUEL_ANSWER_SECONDS = 10
export const DUEL_COUNTDOWN_MS = 3_000
export const DUEL_AUDIO_DELAY_MS = 2_000
export const DUEL_NEXT_QUESTION_DELAY_MS = 3_000
export const DUEL_RESULT_PAUSE_MS = DUEL_NEXT_QUESTION_DELAY_MS
export const DUEL_RECONNECT_GRACE_MS = 15_000
export const DUEL_MIN_VALID_QUESTIONS = 5
export const DUEL_WIN_REWARD = 7
export const DUEL_ROOM_RETENTION_MS = 30 * 60_000
export const DUEL_INVITE_RETENTION_MS = 15 * 60_000

export const DUEL_ROOM_CODE_MIN_LENGTH = 4
export const DUEL_ROOM_CODE_MAX_LENGTH = 12
export const DUEL_PASSWORD_MIN_LENGTH = 4
export const DUEL_PASSWORD_MAX_LENGTH = 12

export const DUEL_ACHIEVEMENT_CONFIG = [
  { slug: 'guess-song-duel-wins-10', title: '初露锋芒', description: '听听·对决累计获胜 10 场。', icon: '⚔️', conditionKey: 'duelWins', conditionValue: 10, sortOrder: 60 },
  { slug: 'guess-song-duel-wins-70', title: '对决高手', description: '听听·对决累计获胜 70 场。', icon: '🏹', conditionKey: 'duelWins', conditionValue: 70, sortOrder: 61 },
  { slug: 'guess-song-duel-wins-727', title: '听听之王', description: '听听·对决累计获胜 727 场。', icon: '👑', conditionKey: 'duelWins', conditionValue: 727, sortOrder: 62 },
  { slug: 'guess-song-duel-participations-100', title: '久经沙场', description: '听听·对决正常完成 100 场。', icon: '🎧', conditionKey: 'duelParticipations', conditionValue: 100, sortOrder: 63 },
  { slug: 'guess-song-duel-participations-270', title: '百听不厌', description: '听听·对决正常完成 270 场。', icon: '🎶', conditionKey: 'duelParticipations', conditionValue: 270, sortOrder: 64 },
  { slug: 'guess-song-duel-participations-727', title: '最佳损友', description: '听听·对决正常完成 727 场。', icon: '🤝', conditionKey: 'duelParticipations', conditionValue: 727, sortOrder: 65 },
] as const

export function normalizeDuelRoomCode(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (
    normalized !== value
    ||
    normalized.length < DUEL_ROOM_CODE_MIN_LENGTH
    || normalized.length > DUEL_ROOM_CODE_MAX_LENGTH
    || !/^[A-Za-z0-9]+$/.test(normalized)
  ) return null
  return normalized
}

export function normalizeDuelPassword(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (
    normalized !== value
    ||
    normalized.length < DUEL_PASSWORD_MIN_LENGTH
    || normalized.length > DUEL_PASSWORD_MAX_LENGTH
    || !/^[A-Za-z0-9]+$/.test(normalized)
  ) return null
  return normalized
}
