/**
 * Shun Master daily opening hours — pure, dependency-free rules.
 *
 * Both the settlement service and the browser page import this module, so the
 * "is it open right now" answer has exactly one definition. Nothing here reads
 * the wall clock: every helper takes the instant to evaluate, so the server can
 * judge with its own clock and tests can freeze time at any boundary.
 *
 * The only supported zone is Beijing time (`Asia/Shanghai`, UTC+8, no DST since
 * 1991), which is why the offset is a constant instead of a timezone database
 * lookup: the same arithmetic then works on the server and in the browser.
 */

export const SHUN_BEIJING_OFFSET_MINUTES = 8 * 60
const MINUTES_PER_DAY = 24 * 60
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/** Defaults published with the feature: 09:00–23:00, restriction enabled. */
export const SHUN_OPEN_HOURS_DEFAULT = {
  openHoursEnabled: true, openTime: '09:00', closeTime: '23:00',
} as const

export type ShunOpenHoursConfig = {
  openHoursEnabled: boolean
  /** `HH:MM` in Beijing time. */
  openTime: string
  /** `HH:MM` in Beijing time, exclusive. */
  closeTime: string
}

/** The closed-state copy. Kept here so server, admin and page agree verbatim. */
export const SHUN_CLOSED_TITLE = '顺大师已加入早睡联盟，正在休息中 💤'

/** `'09:00'` → `540`. Returns null for anything that is not a valid `HH:MM`. */
export function parseShunClock(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = CLOCK_PATTERN.exec(value.trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

const pad = (value: number) => String(value).padStart(2, '0')

/** `540` → `'09:00'`. Zero-padded, for the "每日开放时间" line. */
export function formatShunClock(minutes: number) {
  const safe = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${pad(Math.floor(safe / 60))}:${pad(safe % 60)}`
}

/** `540` → `'9:00'`, matching the published 「请在早上 9:00 后再来！」 copy. */
export function formatShunClockShort(minutes: number) {
  const safe = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${Math.floor(safe / 60)}:${pad(safe % 60)}`
}

/** Minute of the Beijing day (0–1439) for an instant. */
export function beijingMinuteOfDay(at: Date) {
  const utc = at.getUTCHours() * 60 + at.getUTCMinutes()
  return (utc + SHUN_BEIJING_OFFSET_MINUTES) % MINUTES_PER_DAY
}

/** Start of the Beijing day that contains `at`, as a UTC epoch value. */
function beijingDayStart(at: Date) {
  const shifted = at.getTime() + SHUN_BEIJING_OFFSET_MINUTES * 60_000
  return Math.floor(shifted / 86_400_000) * 86_400_000 - SHUN_BEIJING_OFFSET_MINUTES * 60_000
}

/**
 * Normalised window, or null when the configuration cannot express a limit.
 *
 * Equal start and end are rejected by `shunOpenHoursError`, so this branch is
 * unreachable through the admin API; it fails open (treated as 全天开放) rather
 * than silently stopping every take if such a row ever reached the database.
 */
export function shunOpenWindow(value: ShunOpenHoursConfig) {
  const open = parseShunClock(value.openTime)
  const close = parseShunClock(value.closeTime)
  if (open === null || close === null || open === close) return null
  return { open, close, overnight: close < open }
}

/**
 * Left-closed, right-open: `open ≤ now < close` in Beijing time.
 * A window whose close is before its open runs across midnight.
 */
export function isShunOpen(value: ShunOpenHoursConfig, at: Date) {
  if (!value.openHoursEnabled) return true
  const window = shunOpenWindow(value)
  if (!window) return true
  const minute = beijingMinuteOfDay(at)
  return window.overnight
    ? minute >= window.open || minute < window.close
    : minute >= window.open && minute < window.close
}

/**
 * The next instant the window opens, or null when it is already open (or when
 * no window is configured). Anchored to Beijing midnight, so it is correct for
 * cross-midnight windows as well.
 */
export function nextShunOpenAt(value: ShunOpenHoursConfig, at: Date): Date | null {
  if (isShunOpen(value, at)) return null
  const window = shunOpenWindow(value)
  if (!window) return null
  const today = beijingDayStart(at) + window.open * 60_000
  return new Date(today > at.getTime() ? today : today + 86_400_000)
}

/** `'09:00–23:00'` — the published form, zero-padded, en dash. */
export function shunOpenHoursLabel(value: ShunOpenHoursConfig) {
  const open = parseShunClock(value.openTime)
  const close = parseShunClock(value.closeTime)
  if (open === null || close === null) return `${value.openTime}–${value.closeTime}`
  return `${formatShunClock(open)}–${formatShunClock(close)}`
}

/**
 * Natural period word for a clock time. 09:00 and 10:00 must read exactly
 * 「早上 9:00」/「早上 10:00」 as published, so every morning hour stays 早上.
 */
function periodWord(minutes: number) {
  const hour = Math.floor(minutes / 60)
  if (hour < 5) return '凌晨'
  if (hour < 12) return '早上'
  if (hour === 12) return '中午'
  if (hour < 18) return '下午'
  return '晚上'
}

/** 「请在早上 9:00 后再来！」, derived from the configured opening time. */
export function shunOpenHoursHint(value: ShunOpenHoursConfig) {
  const open = parseShunClock(value.openTime)
  if (open === null) return `请在 ${value.openTime} 后再来！`
  return `请在${periodWord(open)} ${formatShunClockShort(open)} 后再来！`
}

/** 「每日开放时间：09:00–23:00」 */
export function shunOpenHoursLine(value: ShunOpenHoursConfig) {
  return `每日开放时间：${shunOpenHoursLabel(value)}`
}

/** The sentence appended to the collapsible rules block. */
export function shunOpenHoursHelp(value: ShunOpenHoursConfig) {
  return value.openHoursEnabled
    ? `顺大师每日开放时间为 ${shunOpenHoursLabel(value)}（北京时间），非开放时间无法发起新的顺取，但仍可查看记录及进行抓捕调查。`
    : '顺大师当前全天开放，仍需遵守每日次数及其他玩法限制。'
}

/** Validation for the three open-hours fields; `null` when they are usable. */
export function shunOpenHoursError(value: unknown): string | null {
  if (!value || typeof value !== 'object') return '开放时间配置格式无效。'
  const c = value as Record<string, unknown>
  // Legacy rows predate the window: defaults are applied instead of rejecting.
  if (c.openHoursEnabled === undefined && c.openTime === undefined && c.closeTime === undefined) return null
  if (c.openHoursEnabled !== undefined && typeof c.openHoursEnabled !== 'boolean') return '开放时间限制开关无效。'
  const open = parseShunClock(c.openTime)
  const close = parseShunClock(c.closeTime)
  if (open === null) return '每日开放开始时间无效，请使用 HH:MM（北京时间）。'
  if (close === null) return '每日开放结束时间无效，请使用 HH:MM（北京时间）。'
  if (open === close) return '每日开放时间的开始时间与结束时间不能相同，请调整其中一个。'
  return null
}

/** Snapshot returned to the page and to the settlement gate. */
export type ShunOpenHoursState = {
  openHoursEnabled: boolean
  openTime: string
  closeTime: string
  /** `'09:00–23:00'` */
  label: string
  open: boolean
  /** ISO instant of the next opening; null while open. */
  nextOpenAt: string | null
}

export function shunOpenHoursState(value: ShunOpenHoursConfig, at: Date): ShunOpenHoursState {
  return {
    openHoursEnabled: value.openHoursEnabled,
    openTime: value.openTime,
    closeTime: value.closeTime,
    label: shunOpenHoursLabel(value),
    open: isShunOpen(value, at),
    nextOpenAt: nextShunOpenAt(value, at)?.toISOString() ?? null,
  }
}

/** Server rejection copy: same wording as the page, plus the opening time. */
export function shunClosedMessage(value: ShunOpenHoursConfig) {
  return `顺大师已加入早睡联盟，正在休息中，${shunOpenHoursHint(value)}`
}
