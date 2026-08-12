import { BEIJING_TIME_ZONE, getBeijingDateKey, shiftBeijingDateKey } from '@/lib/beijing-time'

export const REGISTRATION_TIME_ZONE = BEIJING_TIME_ZONE

/**
 * SCHEDULED is kept as an input/storage compatibility alias for the old
 * one-time window. It is never emitted by the new admin UI or serializers.
 */
export const registrationControlModes = ['MANUAL', 'DAILY_SCHEDULE', 'ONE_TIME'] as const
export const legacyRegistrationControlModes = ['SCHEDULED'] as const
export type CanonicalRegistrationControlMode = (typeof registrationControlModes)[number]
export type RegistrationControlMode = CanonicalRegistrationControlMode | (typeof legacyRegistrationControlModes)[number]

export const registrationControlOverrides = ['NONE', 'OPEN', 'CLOSED'] as const
export type RegistrationControlOverride = (typeof registrationControlOverrides)[number]

export const registrationAvailabilityStatuses = ['CLOSED', 'WAITING', 'OPEN', 'ENDED'] as const
export type RegistrationAvailabilityStatus = (typeof registrationAvailabilityStatuses)[number]

export const REGISTRATION_DAILY_SCHEDULE_MAX_WINDOWS = 10
export const DEFAULT_REGISTRATION_CLOSED_TITLE = '当前暂停注册'
export const DEFAULT_REGISTRATION_CLOSED_MESSAGE = '注册入口目前暂时关闭，请稍后再来。'

export type RegistrationDailyScheduleWindow = {
  start: string
  end: string
}

export type RegistrationAvailabilityWindow = RegistrationDailyScheduleWindow

export type RegistrationControlSettings = {
  mode: RegistrationControlMode
  dailySchedule: RegistrationDailyScheduleWindow[]
  opensAt: Date | null
  closesAt: Date | null
  override: RegistrationControlOverride
  closedTitle?: string
  closedMessage?: string
}

export type RegistrationAvailability = {
  mode: CanonicalRegistrationControlMode
  status: RegistrationAvailabilityStatus
  isOpen: boolean
  dailySchedule: RegistrationDailyScheduleWindow[]
  opensAt: Date | null
  closesAt: Date | null
  currentWindow: RegistrationAvailabilityWindow | null
  nextWindow: RegistrationAvailabilityWindow | null
  nextChangeAt: Date | null
  nextChangeType: 'OPEN' | 'CLOSE' | null
  timezone: typeof REGISTRATION_TIME_ZONE
}

export type RegistrationAvailabilityPayload = {
  mode: CanonicalRegistrationControlMode
  status: RegistrationAvailabilityStatus
  isOpen: boolean
  dailySchedule: RegistrationDailyScheduleWindow[]
  opensAt: string | null
  closesAt: string | null
  currentWindow: RegistrationAvailabilityWindow | null
  nextWindow: RegistrationAvailabilityWindow | null
  nextChangeAt: string | null
  nextChangeType: 'OPEN' | 'CLOSE' | null
  timezone: typeof REGISTRATION_TIME_ZONE
}

export type RegistrationControlPayload = {
  mode: CanonicalRegistrationControlMode
  dailySchedule: RegistrationDailyScheduleWindow[]
  opensAt: string
  closesAt: string
  override: RegistrationControlOverride
  closedTitle: string
  closedMessage: string
}

function normalizeRegistrationClosedTitle(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim().slice(0, 80) : ''
  return normalized || DEFAULT_REGISTRATION_CLOSED_TITLE
}

function normalizeRegistrationClosedMessage(value: unknown) {
  const normalized = typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').trim().slice(0, 2000)
    : ''
  return normalized || DEFAULT_REGISTRATION_CLOSED_MESSAGE
}

const beijingDateTimePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REGISTRATION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function getBeijingDateTimeParts(value: Date) {
  const parts = beijingDateTimePartsFormatter.formatToParts(value)
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>
}

function isValidDate(value: Date | null): value is Date {
  return Boolean(value && !Number.isNaN(value.getTime()))
}

function normalizeTime(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function getTimeMinutes(value: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function isValidRegistrationTime(value: unknown): value is string {
  return getTimeMinutes(normalizeTime(value)) !== null
}

function getWindowSegments(window: RegistrationDailyScheduleWindow) {
  const start = getTimeMinutes(window.start)
  const end = getTimeMinutes(window.end)
  if (start === null || end === null || start === end) return []
  if (start < end) return [[start, end] as const]
  return [[start, 24 * 60] as const, [0, end] as const]
}

/** Returns a user-facing validation message, or null when the schedule is valid. */
export function validateRegistrationDailySchedule(value: unknown): string | null {
  if (!Array.isArray(value)) return '每日定时开放时段格式不正确'
  if (value.length < 1) return '每日定时开放至少需要 1 个时间段'
  if (value.length > REGISTRATION_DAILY_SCHEDULE_MAX_WINDOWS) return `每日定时开放最多支持 ${REGISTRATION_DAILY_SCHEDULE_MAX_WINDOWS} 个时间段`

  const windows: RegistrationDailyScheduleWindow[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '每日定时开放时段格式不正确'
    const candidate = item as Record<string, unknown>
    const start = normalizeTime(candidate.start)
    const end = normalizeTime(candidate.end)
    const startMinutes = getTimeMinutes(start)
    const endMinutes = getTimeMinutes(end)
    if (startMinutes === null || endMinutes === null) return '每日定时开放时间必须使用 HH:mm 格式'
    if (startMinutes === endMinutes) return '每日定时开放时间的开始和结束不能相同'
    windows.push({ start, end })
  }

  for (let leftIndex = 0; leftIndex < windows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < windows.length; rightIndex += 1) {
      const leftSegments = getWindowSegments(windows[leftIndex])
      const rightSegments = getWindowSegments(windows[rightIndex])
      const overlaps = leftSegments.some(([leftStart, leftEnd]) => rightSegments.some(([rightStart, rightEnd]) => Math.max(leftStart, rightStart) < Math.min(leftEnd, rightEnd)))
      if (overlaps) return '每日开放时间段存在重叠，请调整后再保存'
    }
  }

  return null
}

export function parseRegistrationDailyScheduleInput(value: unknown): RegistrationDailyScheduleWindow[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  const normalized: Array<RegistrationDailyScheduleWindow | null> = value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const candidate = item as Record<string, unknown>
    return { start: normalizeTime(candidate.start), end: normalizeTime(candidate.end) }
  })
  if (normalized.some((item) => item === null)) return null
  const windows = normalized.filter((item): item is RegistrationDailyScheduleWindow => item !== null)
  return validateRegistrationDailySchedule(windows) ? null : windows
}

export function normalizeRegistrationControlMode(value: unknown): CanonicalRegistrationControlMode | null {
  if (value === 'SCHEDULED') return 'ONE_TIME'
  return typeof value === 'string' && registrationControlModes.includes(value as CanonicalRegistrationControlMode)
    ? value as CanonicalRegistrationControlMode
    : null
}

export function isValidRegistrationControlMode(value: unknown): value is RegistrationControlMode {
  return normalizeRegistrationControlMode(value) !== null
}

export function isValidRegistrationControlOverride(value: unknown): value is RegistrationControlOverride {
  return typeof value === 'string' && registrationControlOverrides.includes(value as RegistrationControlOverride)
}

/**
 * Parse a timezone-less datetime-local value as Beijing time. The browser's
 * timezone is deliberately ignored; the +08:00 suffix is applied on the
 * server-side parsing path.
 */
export function parseBeijingDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().replace(' ', 'T')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)) return null

  const date = new Date(`${normalized}:00+08:00`)
  if (!isValidDate(date)) return null

  // Date.parse normalizes invalid calendar dates. Compare the formatted
  // Beijing value so 2026-02-31 cannot silently become a March date.
  return formatBeijingDateTimeInput(date) === normalized ? date : null
}

export function formatBeijingDateTimeInput(value: Date | null) {
  if (!isValidDate(value)) return ''
  const parts = getBeijingDateTimeParts(value)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

export function formatBeijingDateTimeDisplay(value: Date | string | null) {
  const date = value instanceof Date ? value : value ? new Date(value) : null
  if (!isValidDate(date)) return ''
  const parts = getBeijingDateTimeParts(date)
  return `${Number(parts.year)}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`
}

export function validateRegistrationControlSettings(value: Pick<RegistrationControlSettings, 'mode' | 'dailySchedule' | 'opensAt' | 'closesAt'>) {
  const mode = normalizeRegistrationControlMode(value.mode)
  if (!mode) return '注册开放模式不正确'
  if (mode === 'DAILY_SCHEDULE') return validateRegistrationDailySchedule(value.dailySchedule)
  if (mode === 'ONE_TIME') {
    if (!value.opensAt || !value.closesAt) return '一次性限时开放必须填写开始时间和结束时间'
    if (value.closesAt <= value.opensAt) return '结束时间必须晚于开始时间'
  }
  return null
}

/** @deprecated Use validateRegistrationControlSettings and check for a message. */
export const isValidRegistrationControlSettings = validateRegistrationControlSettings

export function serializeRegistrationAvailability(value: RegistrationAvailability): RegistrationAvailabilityPayload {
  return {
    mode: value.mode,
    status: value.status,
    isOpen: value.isOpen,
    dailySchedule: value.dailySchedule,
    opensAt: value.opensAt?.toISOString() || null,
    closesAt: value.closesAt?.toISOString() || null,
    currentWindow: value.currentWindow,
    nextWindow: value.nextWindow,
    nextChangeAt: value.nextChangeAt?.toISOString() || null,
    nextChangeType: value.nextChangeType,
    timezone: value.timezone,
  }
}

export function serializeRegistrationControlSettings(value: RegistrationControlSettings): RegistrationControlPayload {
  return {
    mode: normalizeRegistrationControlMode(value.mode) || 'MANUAL',
    dailySchedule: value.dailySchedule || [],
    opensAt: formatBeijingDateTimeInput(value.opensAt),
    closesAt: formatBeijingDateTimeInput(value.closesAt),
    override: value.override,
    closedTitle: normalizeRegistrationClosedTitle(value.closedTitle),
    closedMessage: normalizeRegistrationClosedMessage(value.closedMessage),
  }
}

export function parseRegistrationControlInput(value: unknown): Pick<RegistrationControlSettings, 'mode' | 'dailySchedule' | 'opensAt' | 'closesAt' | 'closedTitle' | 'closedMessage'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  const mode = normalizeRegistrationControlMode(input.mode)
  if (!mode) return null

  const parseOptional = (candidate: unknown) => {
    if (candidate === undefined || candidate === null || candidate === '') return null
    return parseBeijingDateTime(candidate)
  }
  const opensAt = parseOptional(input.opensAt)
  const closesAt = parseOptional(input.closesAt)
  const dailySchedule = parseRegistrationDailyScheduleInput(input.dailySchedule)
  const hasInvalidOpen = input.opensAt !== undefined && input.opensAt !== null && input.opensAt !== '' && !opensAt
  const hasInvalidClose = input.closesAt !== undefined && input.closesAt !== null && input.closesAt !== '' && !closesAt
  if (hasInvalidOpen || hasInvalidClose || !dailySchedule) return null
  return {
    mode,
    dailySchedule,
    opensAt,
    closesAt,
    closedTitle: normalizeRegistrationClosedTitle(input.closedTitle),
    closedMessage: normalizeRegistrationClosedMessage(input.closedMessage),
  }
}

type DailyScheduleOccurrence = {
  window: RegistrationDailyScheduleWindow
  startAt: Date
  endAt: Date
}

function createDailyOccurrences(schedule: RegistrationDailyScheduleWindow[], dateKey: string): DailyScheduleOccurrence[] {
  const nextDateKey = shiftBeijingDateKey(dateKey, 1)
  return schedule.flatMap((window) => {
    const startMinutes = getTimeMinutes(window.start)
    const endMinutes = getTimeMinutes(window.end)
    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return []
    const startAt = parseBeijingDateTime(`${dateKey}T${window.start}`)
    const endAt = parseBeijingDateTime(`${endMinutes > startMinutes ? dateKey : nextDateKey}T${window.end}`)
    return startAt && endAt ? [{ window, startAt, endAt }] : []
  })
}

function resolveDailyScheduleAvailability(schedule: RegistrationDailyScheduleWindow[], now: Date) {
  const today = getBeijingDateKey(now)
  const yesterday = shiftBeijingDateKey(today, -1)
  const tomorrow = shiftBeijingDateKey(today, 1)
  const previousOccurrences = createDailyOccurrences(schedule, yesterday)
  const todayOccurrences = createDailyOccurrences(schedule, today)
  const tomorrowOccurrences = createDailyOccurrences(schedule, tomorrow)
  const current = [...previousOccurrences, ...todayOccurrences].find((occurrence) => now >= occurrence.startAt && now < occurrence.endAt)

  if (current) {
    return {
      status: 'OPEN' as const,
      isOpen: true,
      currentWindow: current.window,
      nextWindow: current.window,
      nextChangeAt: current.endAt,
      nextChangeType: 'CLOSE' as const,
    }
  }

  const next = [...todayOccurrences, ...tomorrowOccurrences]
    .filter((occurrence) => occurrence.startAt > now)
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime())[0]

  return {
    status: 'WAITING' as const,
    isOpen: false,
    currentWindow: null,
    nextWindow: next?.window || null,
    nextChangeAt: next?.startAt || null,
    nextChangeType: next ? 'OPEN' as const : null,
  }
}

export function resolveRegistrationAvailability(input: {
  settings: RegistrationControlSettings
  baseRegistrationOpen: boolean
  now?: Date
}): RegistrationAvailability {
  const now = input.now || new Date()
  const { settings } = input
  const mode = normalizeRegistrationControlMode(settings.mode) || 'MANUAL'
  const dailySchedule = settings.dailySchedule || []
  const base = {
    mode,
    dailySchedule,
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    currentWindow: null,
    nextWindow: null,
    nextChangeAt: null,
    nextChangeType: null,
    timezone: REGISTRATION_TIME_ZONE as typeof REGISTRATION_TIME_ZONE,
  }

  if (!input.baseRegistrationOpen || settings.override === 'CLOSED') {
    return { ...base, status: 'CLOSED', isOpen: false }
  }

  // An explicit OPEN action remains compatible with the existing one-time
  // control. Daily schedules intentionally ignore an old OPEN override and
  // follow their recurring windows; the new UI clears this override too.
  if (settings.override === 'OPEN' && mode !== 'DAILY_SCHEDULE') {
    if (mode === 'ONE_TIME' && settings.closesAt && now >= settings.closesAt) {
      return { ...base, status: 'ENDED', isOpen: false }
    }
    return {
      ...base,
      status: 'OPEN',
      isOpen: true,
      nextChangeAt: mode === 'ONE_TIME' ? settings.closesAt : null,
      nextChangeType: mode === 'ONE_TIME' && settings.closesAt ? 'CLOSE' : null,
    }
  }

  if (mode === 'MANUAL') {
    return { ...base, status: 'OPEN', isOpen: true }
  }

  if (mode === 'DAILY_SCHEDULE') {
    if (validateRegistrationDailySchedule(dailySchedule)) return { ...base, status: 'CLOSED', isOpen: false }
    return { ...base, ...resolveDailyScheduleAvailability(dailySchedule, now) }
  }

  if (!settings.opensAt || !settings.closesAt || settings.closesAt <= settings.opensAt) {
    return { ...base, status: 'CLOSED', isOpen: false }
  }
  if (now < settings.opensAt) {
    return { ...base, status: 'WAITING', isOpen: false, nextChangeAt: settings.opensAt, nextChangeType: 'OPEN' }
  }
  if (now >= settings.closesAt) return { ...base, status: 'ENDED', isOpen: false }
  return { ...base, status: 'OPEN', isOpen: true, nextChangeAt: settings.closesAt, nextChangeType: 'CLOSE' }
}

export function getRegistrationAvailabilityError(value: RegistrationAvailability) {
  if (value.isOpen) return null
  const payload = serializeRegistrationAvailability(value)
  if (value.status === 'WAITING') {
    return {
      status: 403,
      code: 'REGISTRATION_NOT_OPEN_YET',
      message: '本轮注册尚未开放，请在开放时间后再试。',
      meta: payload,
    } as const
  }
  if (value.status === 'ENDED') {
    return {
      status: 403,
      code: 'REGISTRATION_WINDOW_ENDED',
      message: '本轮注册已经结束，请留意下一次开放公告。',
      meta: payload,
    } as const
  }
  return {
    status: 403,
    code: 'REGISTRATION_CLOSED',
    message: '注册暂未开放。',
    meta: payload,
  } as const
}
