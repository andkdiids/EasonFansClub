// 游戏 Session 滑动过期窗口：不是固定总时长上限，而是「不活动窗口」。
// 用户每次真实答题/提示/下一题/状态读取都会把 expiresAt 刷新为 now + TTL。
export const WANT_LISTEN_SESSION_TTL_MS = 2 * 60 * 60 * 1000

// 过期宽限窗口：expiresAt 刚过但在宽限内的会话仍视为可恢复，
// 用户下一次真实操作会将其滑动续期，避免「差几秒丢整局」。
export const WANT_LISTEN_EXPIRY_GRACE_MS = 10 * 60 * 1000

// 无尽模式规则（参考听听 ENDLESS）
export const WANT_LISTEN_BASE_SCORE = 100            // 答对基础分
export const WANT_LISTEN_ENDLESS_COMBO_INTERVAL = 10 // 每连续 10 题触发连击奖励
export const WANT_LISTEN_ENDLESS_COMBO_BONUS = 270   // 连击奖励分
export const WANT_LISTEN_MAX_WRONG_COUNT = 3         // 答错 3 次结束（无尽生命值）

export const WANT_LISTEN_MODES = ['WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE'] as const
export type WantListenMode = (typeof WANT_LISTEN_MODES)[number]

export const WANT_LISTEN_MODE_LABELS: Record<WantListenMode, string> = {
  WANT_LISTEN: '想听',
  CANTONESE_FRAGMENT: '粤语残片',
  FALSE_TITLE: '防不胜防',
}

export const WANT_LISTEN_MODE_DESCRIPTIONS: Record<WantListenMode, string> = {
  WANT_LISTEN: '根据逐渐出现的线索，猜出这首歌。',
  CANTONESE_FRAGMENT: '熟悉的歌词少了一块，你还记得这里唱了什么吗？',
  FALSE_TITLE: '六个歌名，五真一假。找出那个不存在的歌名。',
}

export const WANT_LISTEN_MODE_MAX_SCORES: Record<WantListenMode, number> = {
  WANT_LISTEN: 8000,
  CANTONESE_FRAGMENT: 2000,
  FALSE_TITLE: 2000,
}

export type WantListenConfig = {
  enabled: boolean
  wantListenEnabled: boolean
  cantoneseFragmentEnabled: boolean
  falseTitleEnabled: boolean
}

export const DEFAULT_WANT_LISTEN_CONFIG: WantListenConfig = {
  enabled: true,
  wantListenEnabled: true,
  cantoneseFragmentEnabled: true,
  falseTitleEnabled: true,
}

export function isWantListenMode(value: unknown): value is WantListenMode {
  return typeof value === 'string' && (WANT_LISTEN_MODES as readonly string[]).includes(value)
}

export function isWantListenModeEnabled(config: WantListenConfig, mode: WantListenMode) {
  if (!config.enabled) return false
  if (mode === 'WANT_LISTEN') return config.wantListenEnabled
  if (mode === 'CANTONESE_FRAGMENT') return config.cantoneseFragmentEnabled
  return config.falseTitleEnabled
}

/**
 * 无尽模式计分：答对基础分 + 每连续 10 题连击奖励。
 * 最高分由「总答对数量 + 连续答题表现」决定，不再有 20 题满分上限。
 */
export function scoreForWantListenAnswer(correct: boolean, nextStreak: number) {
  if (!correct) return 0
  const comboBonus = nextStreak > 0 && nextStreak % WANT_LISTEN_ENDLESS_COMBO_INTERVAL === 0
    ? WANT_LISTEN_ENDLESS_COMBO_BONUS
    : 0
  return WANT_LISTEN_BASE_SCORE + comboBonus
}

/** 无尽模式难度循环：每 15 题一轮 EASY→NORMAL→HARD */
export function difficultyForQuestion(position: number) {
  const cycle = (Math.max(1, position) - 1) % 15
  if (cycle < 5) return 'EASY' as const
  if (cycle < 10) return 'NORMAL' as const
  return 'HARD' as const
}

export function modeStatKey(mode: WantListenMode) {
  return mode === 'WANT_LISTEN'
    ? 'wantListen'
    : mode === 'CANTONESE_FRAGMENT'
      ? 'cantoneseFragment'
      : 'falseTitle'
}
