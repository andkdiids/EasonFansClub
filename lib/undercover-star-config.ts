import type { UndercoverDifficulty, UndercoverMatchPhase, UndercoverRole, UndercoverWordCategory } from '@prisma/client'

export const UNDERCOVER_STAR_SLUG = 'undercover-star'
export const UNDERCOVER_MIN_PLAYERS = 3
export const UNDERCOVER_MAX_PLAYERS = 4
// WAITING 房间最长存活时间：超过该时长无任何活动（心跳 / 聊天 / 加入 / 准备等）即自动销毁。
// 注意：此处直接决定「房主关闭网页多久后房间消失」，需求定为 15 分钟。
export const UNDERCOVER_WAITING_TTL_MS = 15 * 60 * 1000
// 等候室心跳间隔：客户端每 30 秒发送一次 PING，服务端据此续活房间 lastActivityAt。
// 仅依赖心跳（beforeunload 不可靠），断开连接后无 PING，房间将在 TTL 内被清理。
export const UNDERCOVER_PRESENCE_HEARTBEAT_MS = 30_000
export const UNDERCOVER_ROLE_REVEAL_MS = 45 * 1000
export const UNDERCOVER_DESCRIPTION_MS = 60 * 1000
export const THINKING_DURATION_MS = 15_000
export const UNDERCOVER_THINKING_MS = THINKING_DURATION_MS
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
  THINKING: '思考阶段',
  VOTING: '投票阶段',
  TIE_VOTING: '平票加赛',
  UNDERCOVER_GUESS: '最后一搏',
  FINISHED: '本局结果',
}

export function isUndercoverDifficulty(value: unknown): value is UndercoverDifficulty {
  return value === 'EASY' || value === 'NORMAL' || value === 'HARD'
}

// ---------------------------------------------------------------------------
// 成长系统（XP / 等级）
// ---------------------------------------------------------------------------

// 参与一局固定 +10 XP，获胜额外 +20 XP（失败则仅参与分）。
// 不做难度倍率、连胜倍率、阵营/回合额外加成，保持简单。
export const UNDERCOVER_XP_PARTICIPATION = 10
export const UNDERCOVER_XP_WIN_BONUS = 20

// 到达各等级所需的累计 XP（索引 0 = Lv1）。超出最高等级后按最高等级封顶。
export const UNDERCOVER_LEVEL_XP_THRESHOLDS = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200]

/** 到达指定等级所需的累计 XP（等级从 1 开始）。 */
export function xpForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.trunc(level || 1))
  const index = Math.min(safeLevel, UNDERCOVER_LEVEL_XP_THRESHOLDS.length) - 1
  return UNDERCOVER_LEVEL_XP_THRESHOLDS[index] ?? 0
}

/** 根据累计 XP 推导当前等级。 */
export function levelFromXp(xp: number): number {
  const safeXp = Math.max(0, Math.trunc(xp || 0))
  let level = 1
  for (let index = UNDERCOVER_LEVEL_XP_THRESHOLDS.length - 1; index >= 0; index -= 1) {
    if (safeXp >= UNDERCOVER_LEVEL_XP_THRESHOLDS[index]) {
      level = index + 1
      break
    }
  }
  return level
}

/** 结算单名玩家的 XP 奖励：参与 +10，获胜额外 +20。 */
export function computeUndercoverXp(input: { isWin: boolean }): number {
  return UNDERCOVER_XP_PARTICIPATION + (input.isWin ? UNDERCOVER_XP_WIN_BONUS : 0)
}

export function isUndercoverCategory(value: unknown): value is UndercoverWordCategory {
  return value === 'SONG' || value === 'ALBUM' || value === 'EASON_RELATED' || value === 'GENERAL'
}

export function isUndercoverPhase(value: unknown): value is UndercoverMatchPhase {
  return value === 'ROLE_REVEAL' || value === 'DESCRIBING' || value === 'THINKING' || value === 'VOTING' || value === 'TIE_VOTING' || value === 'UNDERCOVER_GUESS' || value === 'FINISHED'
}
