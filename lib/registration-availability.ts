import { BEIJING_TIME_ZONE } from '@/lib/beijing-time'

export const REGISTRATION_TIME_ZONE = BEIJING_TIME_ZONE

export const registrationControlModes = ['MANUAL', 'SCHEDULED'] as const
export type RegistrationControlMode = (typeof registrationControlModes)[number]

export const registrationControlOverrides = ['NONE', 'OPEN', 'CLOSED'] as const
export type RegistrationControlOverride = (typeof registrationControlOverrides)[number]

export const registrationAvailabilityStatuses = ['CLOSED', 'WAITING', 'OPEN', 'ENDED'] as const
export type RegistrationAvailabilityStatus = (typeof registrationAvailabilityStatuses)[number]

export type RegistrationControlSettings = {
  mode: RegistrationControlMode
  opensAt: Date | null
  closesAt: Date | null
  override: RegistrationControlOverride
}

export type RegistrationAvailability = {
  mode: RegistrationControlMode
  status: RegistrationAvailabilityStatus
  isOpen: boolean
  opensAt: Date | null
  closesAt: Date | null
  timezone: typeof REGISTRATION_TIME_ZONE
}

export type RegistrationAvailabilityPayload = {
  mode: RegistrationControlMode
  status: RegistrationAvailabilityStatus
  isOpen: boolean
  opensAt: string | null
  closesAt: string | null
  timezone: typeof REGISTRATION_TIME_ZONE
}

export type RegistrationControlPayload = {
  mode: RegistrationControlMode
  opensAt: string
  closesAt: string
  override: RegistrationControlOverride
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

export function isValidRegistrationControlMode(value: unknown): value is RegistrationControlMode {
  return typeof value === 'string' && registrationControlModes.includes(value as RegistrationControlMode)
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

export function serializeRegistrationAvailability(value: RegistrationAvailability): RegistrationAvailabilityPayload {
  return {
    mode: value.mode,
    status: value.status,
    isOpen: value.isOpen,
    opensAt: value.opensAt?.toISOString() || null,
    closesAt: value.closesAt?.toISOString() || null,
    timezone: value.timezone,
  }
}

export function serializeRegistrationControlSettings(value: RegistrationControlSettings): RegistrationControlPayload {
  return {
    mode: value.mode,
    opensAt: formatBeijingDateTimeInput(value.opensAt),
    closesAt: formatBeijingDateTimeInput(value.closesAt),
    override: value.override,
  }
}

export function parseRegistrationControlInput(value: unknown): Pick<RegistrationControlSettings, 'mode' | 'opensAt' | 'closesAt'> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const input = value as Record<string, unknown>
  if (!isValidRegistrationControlMode(input.mode)) return null

  const parseOptional = (candidate: unknown) => {
    if (candidate === undefined || candidate === null || candidate === '') return null
    return parseBeijingDateTime(candidate)
  }
  const opensAt = parseOptional(input.opensAt)
  const closesAt = parseOptional(input.closesAt)
  const hasInvalidOpen = input.opensAt !== undefined && input.opensAt !== null && input.opensAt !== '' && !opensAt
  const hasInvalidClose = input.closesAt !== undefined && input.closesAt !== null && input.closesAt !== '' && !closesAt
  if (hasInvalidOpen || hasInvalidClose) return null
  return { mode: input.mode, opensAt, closesAt }
}

export function resolveRegistrationAvailability(input: {
  settings: RegistrationControlSettings
  baseRegistrationOpen: boolean
  now?: Date
}): RegistrationAvailability {
  const now = input.now || new Date()
  const { settings } = input
  const base = {
    mode: settings.mode,
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    timezone: REGISTRATION_TIME_ZONE as typeof REGISTRATION_TIME_ZONE,
  }

  if (!input.baseRegistrationOpen || settings.override === 'CLOSED') {
    return { ...base, status: 'CLOSED', isOpen: false }
  }

  // An explicit OPEN action is a server-side override. It is never inferred
  // from a browser clock and opens a scheduled window early, while the
  // configured close time still remains the hard stop for that round.
  if (settings.override === 'OPEN') {
    if (settings.mode === 'SCHEDULED' && settings.closesAt && now >= settings.closesAt) {
      return { ...base, status: 'ENDED', isOpen: false }
    }
    return { ...base, status: 'OPEN', isOpen: true }
  }

  if (settings.mode === 'MANUAL') {
    return { ...base, status: 'OPEN', isOpen: true }
  }

  if (!settings.opensAt || !settings.closesAt || settings.closesAt <= settings.opensAt) {
    return { ...base, status: 'CLOSED', isOpen: false }
  }
  if (now < settings.opensAt) return { ...base, status: 'WAITING', isOpen: false }
  if (now >= settings.closesAt) return { ...base, status: 'ENDED', isOpen: false }
  return { ...base, status: 'OPEN', isOpen: true }
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
      message: '本轮注册已结束，请留意下一次开放公告。',
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
