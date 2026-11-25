import { randomInt } from 'node:crypto'
import { weightedIndex as weightedDraw } from './shun-config'

/**
 * Runtime helpers for the Shun Master service.
 *
 * Configuration rules live in `lib/shun-config.ts` (pure, shared with the admin
 * form); this module only adds the crypto-backed randomness and date helpers.
 */
export {
  ACTIVITY_TIER_LABELS, ACTIVITY_WEIGHT_RANGE, FRIEND_CHANCE_DEFAULT, RECOVERY_BONUS_CHANCE_DEFAULT,
  SHUN_ACTIVITY_TIERS, SHUN_AMOUNT_TIERS, SHUN_CAPTURE_NOTIFY_STATUS, SHUN_CAPTURE_NOTIFY_WINDOW_MS,
  SHUN_NOTIFY_STATUS, SHUN_NOTIFY_WINDOW_MS, activityTier, defaultShunConfig,
  friendPoolDraw, pickStratified, shunConfigError, shunRulesChanged, validateShunConfig,
  type ShunConfig, type ShunNotifyStatus, type StratifiedCandidate,
} from './shun-config'

export {
  SHUN_BEIJING_OFFSET_MINUTES, SHUN_CLOSED_TITLE, SHUN_OPEN_HOURS_DEFAULT,
  beijingMinuteOfDay, formatShunClock, formatShunClockShort, isShunOpen, nextShunOpenAt,
  parseShunClock, shunClosedMessage, shunOpenHoursError, shunOpenHoursHelp, shunOpenHoursHint,
  shunOpenHoursLabel, shunOpenHoursLine, shunOpenHoursState, shunOpenWindow,
  type ShunOpenHoursConfig, type ShunOpenHoursState,
} from './shun-open-hours'

/** Weighted lottery over one ticket space; randomness defaults to `randomInt`. */
export function weightedIndex(weights: number[], draw: (max: number) => number = randomInt) {
  return weightedDraw(weights, draw)
}

export function shunDay(now: Date) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10)
}

export function captureMode(now: Date, goldenUntil: Date) {
  return now < goldenUntil ? 2 : 3
}

export function shuffle<T>(values: T[]): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}
