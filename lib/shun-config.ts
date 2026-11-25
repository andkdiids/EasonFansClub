/**
 * Pure, dependency-free Shun Master configuration rules.
 *
 * The server service, the admin API and the admin form all import this module,
 * so "what a valid configuration is" has exactly one definition and the client
 * never pulls `node:crypto` into the browser bundle.
 */

import { SHUN_OPEN_HOURS_DEFAULT, shunOpenHoursError } from './shun-open-hours'

export const SHUN_AMOUNT_TIERS = 7
export const SHUN_ACTIVITY_TIERS = 5
export const ACTIVITY_TIER_LABELS = ['极低', '低', '中', '高', '极高'] as const
export const ACTIVITY_WEIGHT_RANGE = { min: 1, max: 300 } as const
export const FRIEND_CHANCE_DEFAULT = 20

/**
 * Deferred notification window.
 *
 * A take settles immediately, but the victim is only told once the actor picks
 * "no letter", sends a letter, or this window expires. The server sweeper owns
 * the expiry path, so closing the tab can never leave a victim unnotified.
 * Fixed on purpose: reliability first, no extra administrator setting.
 */
export const SHUN_NOTIFY_WINDOW_MS = 120_000
export const SHUN_NOTIFY_STATUS = {
  pending: 'PENDING',
  plain: 'SENT_PLAIN',
  letter: 'SENT_LETTER',
} as const
export type ShunNotifyStatus = typeof SHUN_NOTIFY_STATUS[keyof typeof SHUN_NOTIFY_STATUS]

/**
 * Capture-result notification state machine.
 *
 * A successful capture settles the recovery (and the optional bonus) at once,
 * but the real Shun actor is only told after the capturer decides whether to
 * leave a counter note — or after this window expires. It shares the same
 * 120-second reliability window and the same server-side sweep as the take
 * notification, so closing the page can never leave the actor unnotified.
 */
export const SHUN_CAPTURE_NOTIFY_STATUS = SHUN_NOTIFY_STATUS
export const SHUN_CAPTURE_NOTIFY_WINDOW_MS = SHUN_NOTIFY_WINDOW_MS

/**
 * Default chance (in percent) that a successful capture also pays a platform
 * bonus equal to the amount actually recovered. Administrator-configurable
 * 0–100. Invisible to players: it is never part of any notification or page.
 */
export const RECOVERY_BONUS_CHANCE_DEFAULT = 5

export const defaultShunConfig = {
  enabled: false, attempts: 7, victimCap: 4, goldenMinutes: 10,
  probabilities: [25, 21, 17, 14, 10, 7, 6], weights: [130, 122, 115, 108, 100],
  friendChance: FRIEND_CHANCE_DEFAULT,
  bonusChance: RECOVERY_BONUS_CHANCE_DEFAULT,
  // Daily opening window, Beijing time, left-closed / right-open. Widened on
  // purpose: `ShunConfig` must allow any boolean/time the admin panel saves.
  openHoursEnabled: SHUN_OPEN_HOURS_DEFAULT.openHoursEnabled as boolean,
  openTime: SHUN_OPEN_HOURS_DEFAULT.openTime as string,
  closeTime: SHUN_OPEN_HOURS_DEFAULT.closeTime as string,
}
export type ShunConfig = typeof defaultShunConfig

export function shunRulesChanged(previous: ShunConfig, next: ShunConfig) {
  return previous.attempts !== next.attempts || previous.victimCap !== next.victimCap
    || previous.goldenMinutes !== next.goldenMinutes || previous.friendChance !== next.friendChance
    || previous.probabilities.some((value, i) => value !== next.probabilities[i])
    || previous.weights.some((value, i) => value !== next.weights[i])
}

const bounded = (value: unknown, low: number, high: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= low && value <= high

/**
 * Validation only checks ranges and the 100% total.
 *
 * Ordering is deliberately NOT a rule any more: the seven amount tiers and the
 * five activity weights may be configured in any order (including flat), and
 * the draw is still a plain weighted lottery. Errors name the field that is
 * actually wrong so administrators are never sent to fix the wrong input.
 */
export function shunConfigError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '配置格式无效。'
  const c = value as Record<string, unknown>
  if (typeof c.enabled !== 'boolean') return '启用状态无效。'
  if (!bounded(c.attempts, 1, 30)) return '每日顺取次数必须是 1 到 30 的整数。'
  if (!bounded(c.victimCap, 1, 20)) return '每日被顺上限必须是 1 到 20 的整数。'
  if (!bounded(c.goldenMinutes, 1, 60)) return '黄金抓捕期必须是 1 到 60 分钟的整数。'
  if (!Array.isArray(c.probabilities) || c.probabilities.length !== SHUN_AMOUNT_TIERS
    || !c.probabilities.every((n) => bounded(n, 0, 100))) {
    return '金额概率必须是 7 档 0 到 100 的整数。'
  }
  if (c.probabilities.reduce((sum: number, n) => sum + (n as number), 0) !== 100) return '金额概率必须合计 100%。'
  if (!c.probabilities.some((n) => (n as number) > 0)) return '金额概率至少要有一档大于 0%。'
  if (!Array.isArray(c.weights) || c.weights.length !== SHUN_ACTIVITY_TIERS
    || !c.weights.every((n) => bounded(n, ACTIVITY_WEIGHT_RANGE.min, ACTIVITY_WEIGHT_RANGE.max))) {
    return '活跃度权重必须是 5 档 1 到 300 的整数。'
  }
  // Absent on configurations saved before the friend pool existed.
  if (c.friendChance !== undefined && !bounded(c.friendChance, 0, 100)) {
    return '好友命中概率必须是 0 到 100 的整数。'
  }
  // Absent on configurations saved before the recovery bonus existed. Both
  // bounds are allowed on purpose: 0% disables the roll, 100% makes it certain.
  if (c.bonusChance !== undefined && !bounded(c.bonusChance, 0, 100)) {
    return '追回额外奖励概率必须是 0 到 100 的整数。'
  }
  // Absent on configurations saved before the daily window existed. Both fields
  // are still validated when the restriction is switched off, so re-enabling it
  // later can never fail on a value that was saved while it was dormant.
  const openHoursInvalid = shunOpenHoursError(c)
  if (openHoursInvalid) return openHoursInvalid
  return null
}

export function validateShunConfig(value: unknown): ShunConfig | null {
  if (shunConfigError(value)) return null
  const c = value as Partial<ShunConfig>
  return {
    enabled: c.enabled as boolean, attempts: c.attempts as number, victimCap: c.victimCap as number,
    goldenMinutes: c.goldenMinutes as number, probabilities: c.probabilities as number[],
    weights: c.weights as number[],
    // Legacy rows predate the friend pool: default it instead of rejecting them.
    friendChance: typeof c.friendChance === 'number' ? c.friendChance : FRIEND_CHANCE_DEFAULT,
    // Same for the recovery bonus: a configuration saved before V5 keeps the
    // published 5% default instead of silently turning the bonus off.
    bonusChance: typeof c.bonusChance === 'number' ? c.bonusChance : RECOVERY_BONUS_CHANCE_DEFAULT,
    // And for the daily window: a row saved before V6 keeps the published
    // 09:00–23:00 restriction instead of becoming silently unrestricted.
    openHoursEnabled: typeof c.openHoursEnabled === 'boolean'
      ? c.openHoursEnabled : SHUN_OPEN_HOURS_DEFAULT.openHoursEnabled,
    openTime: typeof c.openTime === 'string' ? c.openTime : SHUN_OPEN_HOURS_DEFAULT.openTime,
    closeTime: typeof c.closeTime === 'string' ? c.closeTime : SHUN_OPEN_HOURS_DEFAULT.closeTime,
  }
}

/**
 * Days of activity in the last week → the 0..4 tier.
 * The mapping itself is unchanged from the original implementation.
 */
export function activityTier(activeDays: number) {
  return Math.min(SHUN_ACTIVITY_TIERS - 1, Math.floor(activeDays * SHUN_ACTIVITY_TIERS / 8))
}

/** Weighted lottery over one ticket space, with an injectable draw for tests. */
export function weightedIndex(weights: number[], draw: (max: number) => number) {
  const total = weights.reduce((sum, n) => sum + n, 0)
  if (total <= 0) return -1
  let ticket = draw(total)
  return weights.findIndex((weight) => (ticket -= weight) < 0)
}

/** One eligible target, already reduced to what the lottery needs. */
export type StratifiedCandidate = { id: string; uid: number; tier: number }

/**
 * Two-stage target lottery.
 *
 * Stage 1 draws an activity tier using the configured weights, after dropping
 * empty tiers and renormalising the remaining ones. Stage 2 draws one candidate
 * uniformly inside that tier. Population size therefore stops dominating: five
 * equally weighted non-empty tiers are hit equally often regardless of how many
 * users each one holds.
 */
export function pickStratified<T extends StratifiedCandidate>(candidates: T[],
  weights: number[], draw: (max: number) => number): T | null {
  if (!candidates.length) return null
  const buckets = new Map<number, T[]>()
  for (const candidate of candidates) {
    const bucket = buckets.get(candidate.tier)
    if (bucket) bucket.push(candidate)
    else buckets.set(candidate.tier, [candidate])
  }
  const tiers = [...buckets.keys()].sort((a, b) => a - b)
  const chosen = weightedIndex(tiers.map((tier) => weights[tier] ?? 0), draw)
  if (chosen < 0) return null
  const bucket = buckets.get(tiers[chosen]) as T[]
  return bucket[draw(bucket.length)]
}

/**
 * Whether this transfer tries the friend-first pool first.
 * Hidden mechanic: never surfaced to the player, never part of a notification.
 */
export function friendPoolDraw(friendChance: number, draw: (max: number) => number) {
  return friendChance > 0 && draw(100) < friendChance
}
