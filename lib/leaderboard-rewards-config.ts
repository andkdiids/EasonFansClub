/**
 * Pure, dependency-free configuration rules for the leaderboard automatic
 * reward settlement. The server service, admin API and admin form all import
 * this module so "what a valid config is" has exactly one definition, and the
 * client never pulls server-only modules into the browser bundle.
 *
 * Three independent weekly categories, each with its own 270 cap. Entertainment
 * also has a separate monthly award that does NOT consume any weekly cap.
 */

export const LEADERBOARD_REWARD_CATEGORIES = ['entertainment', 'comment', 'aspirin'] as const
export type LeaderboardRewardCategory = (typeof LEADERBOARD_REWARD_CATEGORIES)[number]

/** Weekly cap per user, per category. Three independent budgets. */
export const WEEKLY_CAP = 270

export const DEFAULT_AMOUNTS = {
  /** Entertainment weekly: ranks 1-3 / 4-10. */
  entertainmentWeeklyTop3: 74,
  entertainmentWeeklyTop4To10: 27,
  /** Entertainment monthly extra: ranks 1-3 / 4-10. */
  entertainmentMonthlyTop3: 127,
  entertainmentMonthlyTop4To10: 74,
  /** Community comment weekly: ranks 1-3 / 4-10. */
  commentWeeklyTop3: 74,
  commentWeeklyTop4To10: 27,
  /** Aspirin consultation weekly: ranks 1-3 / 4-10. */
  aspirinWeeklyTop3: 74,
  aspirinWeeklyTop4To10: 27,
} as const

export const BADGE_KEYS = ['thankYou', 'kSongKing'] as const
export type RewardBadgeKey = (typeof BADGE_KEYS)[number]

/**
 * Shape of the persisted config JSON. `enabledAt` records the official go-live
 * instant: no period that starts before it may be auto-settled, which is what
 * protects all historical cycles from an accidental backfill on first launch.
 */
export type LeaderboardRewardsConfig = {
  enabled: boolean
  /** ISO instant (Asia/Shanghai wall-clock semantics) of first enable. */
  enabledAt: string | null
  entertainment: {
    weeklyEnabled: boolean
    monthlyEnabled: boolean
    weeklyTop3: number
    weeklyTop4To10: number
    monthlyTop3: number
    monthlyTop4To10: number
    weeklyCap: number
    kSongKingEnabled: boolean
    /** Optional binding to an existing Badge.id. Empty string = not bound. */
    kSongKingBadgeId: string
  }
  comment: {
    weeklyEnabled: boolean
    weeklyTop3: number
    weeklyTop4To10: number
    weeklyCap: number
    thankYouEnabled: boolean
    thankYouBadgeId: string
  }
  aspirin: {
    weeklyEnabled: boolean
    weeklyTop3: number
    weeklyTop4To10: number
    weeklyCap: number
  }
}

export const defaultLeaderboardRewardsConfig: LeaderboardRewardsConfig = {
  enabled: false,
  enabledAt: null,
  entertainment: {
    weeklyEnabled: true,
    monthlyEnabled: true,
    weeklyTop3: DEFAULT_AMOUNTS.entertainmentWeeklyTop3,
    weeklyTop4To10: DEFAULT_AMOUNTS.entertainmentWeeklyTop4To10,
    monthlyTop3: DEFAULT_AMOUNTS.entertainmentMonthlyTop3,
    monthlyTop4To10: DEFAULT_AMOUNTS.entertainmentMonthlyTop4To10,
    weeklyCap: WEEKLY_CAP,
    kSongKingEnabled: true,
    kSongKingBadgeId: '',
  },
  comment: {
    weeklyEnabled: true,
    weeklyTop3: DEFAULT_AMOUNTS.commentWeeklyTop3,
    weeklyTop4To10: DEFAULT_AMOUNTS.commentWeeklyTop4To10,
    weeklyCap: WEEKLY_CAP,
    thankYouEnabled: true,
    thankYouBadgeId: '',
  },
  aspirin: {
    weeklyEnabled: true,
    weeklyTop3: DEFAULT_AMOUNTS.aspirinWeeklyTop3,
    weeklyTop4To10: DEFAULT_AMOUNTS.aspirinWeeklyTop4To10,
    weeklyCap: WEEKLY_CAP,
  },
}

const isNonNegativeInt = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isCap = (value: unknown) => isNonNegativeInt(value) && (value as number) <= 1_000_000

/** Validate a draft config. Returns a human-readable error or null when valid. */
export function leaderboardRewardsConfigError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '配置格式无效。'
  const c = value as Record<string, unknown>
  if (typeof c.enabled !== 'boolean') return '启用状态无效。'
  if (c.enabledAt !== null && typeof c.enabledAt !== 'string') return '生效时间无效。'
  if (c.enabledAt && Number.isNaN(Date.parse(c.enabledAt))) return '生效时间不是有效日期。'

  const groups: Array<[string, unknown]> = [
    ['entertainment', c.entertainment],
    ['comment', c.comment],
    ['aspirin', c.aspirin],
  ]
  const amountFields = [
    'weeklyTop3', 'weeklyTop4To10', 'monthlyTop3', 'monthlyTop4To10',
  ]
  for (const [name, raw] of groups) {
    if (!raw || typeof raw !== 'object') return `${name} 配置无效。`
    const g = raw as Record<string, unknown>
    if (typeof g.weeklyEnabled !== 'boolean') return `${name} 周榜开关无效。`
    for (const field of amountFields) {
      if (g[field] !== undefined && !isNonNegativeInt(g[field])) return `${name}.${field} 必须是非负整数。`
    }
    if (!isCap(g.weeklyCap)) return `${name}.weeklyCap 必须是 0 到 1,000,000 的整数。`
  }
  const ent = c.entertainment as Record<string, unknown>
  if (typeof ent.monthlyEnabled !== 'boolean') return '月榜开关无效。'
  if (typeof ent.kSongKingEnabled !== 'boolean') return 'K歌之王开关无效。'
  if (typeof ent.kSongKingBadgeId !== 'string') return 'K歌之王勋章绑定无效。'
  const cmt = c.comment as Record<string, unknown>
  if (typeof cmt.thankYouEnabled !== 'boolean') return '谢谢侬开关无效。'
  if (typeof cmt.thankYouBadgeId !== 'string') return '谢谢侬勋章绑定无效。'
  // Binding may be empty: an enabled badge rule with no bound Badge simply grants
  // nothing (the settlement engine checks `&& badgeId`). The admin is expected
  // to bind a badge, but an unbound rule is a valid, safe state — never an error.
  return null
}

/** Merge a draft over defaults, tolerating fields saved by older versions. */
export function validateLeaderboardRewardsConfig(value: unknown): LeaderboardRewardsConfig | null {
  if (leaderboardRewardsConfigError(value)) return null
  const c = value as Partial<LeaderboardRewardsConfig>
  const d = defaultLeaderboardRewardsConfig
  const ent = c.entertainment || d.entertainment
  const cmt = c.comment || d.comment
  const asp = c.aspirin || d.aspirin
  return {
    enabled: c.enabled as boolean,
    enabledAt: typeof c.enabledAt === 'string' ? c.enabledAt : null,
    entertainment: {
      weeklyEnabled: ent.weeklyEnabled,
      monthlyEnabled: ent.monthlyEnabled,
      weeklyTop3: ent.weeklyTop3,
      weeklyTop4To10: ent.weeklyTop4To10,
      monthlyTop3: ent.monthlyTop3,
      monthlyTop4To10: ent.monthlyTop4To10,
      weeklyCap: ent.weeklyCap,
      kSongKingEnabled: ent.kSongKingEnabled,
      kSongKingBadgeId: ent.kSongKingBadgeId,
    },
    comment: {
      weeklyEnabled: cmt.weeklyEnabled,
      weeklyTop3: cmt.weeklyTop3,
      weeklyTop4To10: cmt.weeklyTop4To10,
      weeklyCap: cmt.weeklyCap,
      thankYouEnabled: cmt.thankYouEnabled,
      thankYouBadgeId: cmt.thankYouBadgeId,
    },
    aspirin: {
      weeklyEnabled: asp.weeklyEnabled,
      weeklyTop3: asp.weeklyTop3,
      weeklyTop4To10: asp.weeklyTop4To10,
      weeklyCap: asp.weeklyCap,
    },
  }
}

/** Rank → configured reward. Ranks 1-3 use top3, 4-10 use top4To10, else 0. */
export function rankReward(rank: number, top3: number, top4To10: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0
  if (rank <= 3) return top3
  if (rank <= 10) return top4To10
  return 0
}
