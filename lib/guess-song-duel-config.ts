export type DuelMode = 'SCORE' | 'BUZZER'

export const DUEL_SCORE_TOTAL_QUESTIONS = 30
export const DUEL_BUZZER_TOTAL_QUESTIONS = 31
// Kept as the legacy default for callers that predate the two-mode split.
export const DUEL_TOTAL_QUESTIONS = DUEL_SCORE_TOTAL_QUESTIONS
export const DUEL_TARGET_CORRECT = 16
export const DUEL_AUDIO_DURATION_SECONDS = 7
export const DUEL_ANSWER_SECONDS = 10
export const DUEL_COUNTDOWN_MS = 3_000
export const DUEL_AUDIO_DELAY_MS = 2_000
export const DUEL_NEXT_QUESTION_DELAY_MS = 3_000
export const DUEL_RESULT_PAUSE_MS = DUEL_NEXT_QUESTION_DELAY_MS
export const DUEL_RECONNECT_GRACE_MS = 15_000
export const DUEL_HEARTBEAT_INTERVAL_MS = 5_000
export const DUEL_ROOM_POLL_INTERVAL_MS = 2_500
export const DUEL_ONLINE_TIMEOUT_MS = 20_000
// Heartbeats normally arrive every five seconds. This larger bound is only a
// recovery safety net for a crashed browser/server; structural room/member
// checks remain the primary active-duel decision.
export const DUEL_STALE_MATCH_MS = 2 * 60_000
export const DUEL_MIN_VALID_QUESTIONS = 5
export const DUEL_WIN_REWARD = 7
export const DUEL_WAITING_ROOM_TTL_MS = 30 * 60_000
// Backwards-compatible name for callers that used the old retention constant.
export const DUEL_ROOM_RETENTION_MS = DUEL_WAITING_ROOM_TTL_MS
export const DUEL_INVITE_RETENTION_MS = 15 * 60_000

export const DUEL_MODE_LABELS: Record<DuelMode, string> = {
  SCORE: '比分模式',
  BUZZER: '抢答模式',
}

export const DUEL_MODE_RULES: Record<DuelMode, string> = {
  SCORE: '双方同时挑战相同的 30 道题，每题只能作答一次。30 题结束后，答对更多的一方获胜。',
  BUZZER: '双方抢答相同题目，抢答正确即可拿下本题；抢答错误后本题不能再次作答，对方仍可继续回答。率先拿下 16 题者获胜。',
}

export function normalizeDuelMode(value: unknown): DuelMode | null {
  if (value === 'SCORE' || value === 'BUZZER') return value
  return null
}

export function getDuelBaseQuestionCount(mode: DuelMode) {
  return mode === 'BUZZER' ? DUEL_BUZZER_TOTAL_QUESTIONS : DUEL_SCORE_TOTAL_QUESTIONS
}

export function getDuelModeLabel(mode: DuelMode) {
  return DUEL_MODE_LABELS[mode]
}

export function getDuelModeRule(mode: DuelMode) {
  return DUEL_MODE_RULES[mode]
}

export function isDuelWaitingRoomExpired(
  status: 'WAITING' | 'READY' | 'PLAYING' | 'FINISHED' | 'CLOSED',
  createdAt: Date | string | number,
  now = Date.now(),
) {
  if (status !== 'WAITING' && status !== 'READY') return false
  const createdTimestamp = createdAt instanceof Date ? createdAt.getTime() : typeof createdAt === 'number' ? createdAt : new Date(createdAt).getTime()
  return Number.isFinite(createdTimestamp) && now - createdTimestamp >= DUEL_WAITING_ROOM_TTL_MS
}

export function isDuelPresenceOnline(lastSeenAt: Date | string | number | null | undefined, now = Date.now()) {
  if (lastSeenAt === null || lastSeenAt === undefined) return false
  const timestamp = lastSeenAt instanceof Date ? lastSeenAt.getTime() : typeof lastSeenAt === 'number' ? lastSeenAt : new Date(lastSeenAt).getTime()
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= DUEL_ONLINE_TIMEOUT_MS
}

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
