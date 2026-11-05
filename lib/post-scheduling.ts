export const POST_SCHEDULE_TIME_ZONE = 'Asia/Shanghai'
export const POST_SCHEDULE_MINIMUM_LEAD_TIME_MS = 30 * 60 * 1000

export type PostPublicationStatus = 'WAITING_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'CANCELLED'
export type PostPublishMode = 'IMMEDIATE' | 'SCHEDULED'

type DateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function readDateTimeParts(value: string): DateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [, yearText, monthText, dayText, hourText, minuteText] = match
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
  }
  if (parts.year < 1000 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59) return null
  const validation = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute))
  if (validation.getUTCFullYear() !== parts.year || validation.getUTCMonth() !== parts.month - 1 || validation.getUTCDate() !== parts.day) return null
  return parts
}

function dateTimePartsInZone(date: Date, timeZone: string): DateTimeParts {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(values.find((item) => item.type === type)?.value)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') }
}

function sameDateTimeParts(left: DateTimeParts, right: DateTimeParts) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
}

/** Parse the datetime-local wall clock as a product-time-zone value, never as browser-local time. */
export function parseDateTimeLocalInZone(value: string, timeZone = POST_SCHEDULE_TIME_ZONE): Date | null {
  const desired = readDateTimeParts(value)
  if (!desired) return null
  const desiredAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute)
  let epochMs = desiredAsUtc

  // Resolve the wall-clock offset using Intl. The iteration also rejects a
  // nonexistent local time in a zone that observes daylight-saving changes.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const represented = dateTimePartsInZone(new Date(epochMs), timeZone)
    const representedAsUtc = Date.UTC(represented.year, represented.month - 1, represented.day, represented.hour, represented.minute)
    const adjustment = representedAsUtc - desiredAsUtc
    if (adjustment === 0) return sameDateTimeParts(represented, desired) ? new Date(epochMs) : null
    epochMs -= adjustment
  }

  return sameDateTimeParts(dateTimePartsInZone(new Date(epochMs), timeZone), desired) ? new Date(epochMs) : null
}

/** Format an instant as the value expected by an HTML datetime-local control. */
export function formatDateTimeLocalInZone(date: Date, timeZone = POST_SCHEDULE_TIME_ZONE) {
  const parts = dateTimePartsInZone(date, timeZone)
  const two = (value: number) => String(value).padStart(2, '0')
  return `${String(parts.year).padStart(4, '0')}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`
}

/** Format user-visible schedule times in the site's Shanghai time zone. */
export function formatScheduledPostTime(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: POST_SCHEDULE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

/** API values must carry an explicit UTC offset; bare local timestamps are ambiguous. */
export function parseScheduledPublishAt(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null

  const [datePart, timePart] = value.split('T')
  const [year, month, day] = datePart.split('-').map(Number)
  const timeMatch = /^(\d{2}):(\d{2}):(\d{2})/.exec(timePart)
  if (!timeMatch) return null
  const [, hour, minute, second] = timeMatch.map(Number)
  const validation = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (validation.getUTCFullYear() !== year || validation.getUTCMonth() !== month - 1 || validation.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null
  return date
}

export function isScheduledPostTimeValid(scheduledAt: Date, now = new Date()) {
  return Number.isFinite(scheduledAt.getTime())
    && scheduledAt.getTime() >= now.getTime() + POST_SCHEDULE_MINIMUM_LEAD_TIME_MS
}

export function shouldPublishPostOnApproval(input: {
  publicationStatus: string
  scheduledPublishAt: Date | null
  now: Date
}) {
  if (input.publicationStatus !== 'SCHEDULED') return true
  return Boolean(input.scheduledPublishAt && input.scheduledPublishAt <= input.now)
}

export function isApprovedScheduledPostDue(input: {
  isDeleted: boolean
  status: string
  moderationStatus: string
  publicationStatus: string
  scheduledPublishAt: Date | null
}, now: Date) {
  return !input.isDeleted
    && input.status === 'DRAFT'
    && input.moderationStatus === 'APPROVED'
    && input.publicationStatus === 'SCHEDULED'
    && Boolean(input.scheduledPublishAt && input.scheduledPublishAt <= now)
}

export function isCancellableApprovedSchedule(input: {
  isDeleted: boolean
  status: string
  moderationStatus: string
  publicationStatus: string
}) {
  return !input.isDeleted
    && input.status === 'DRAFT'
    && input.moderationStatus === 'APPROVED'
    && input.publicationStatus === 'SCHEDULED'
}

export function getPostPublicationLabel(input: {
  moderationStatus: string
  publicationStatus: string
}): string {
  if (input.moderationStatus === 'PENDING') return '待审核'
  if (input.moderationStatus === 'REJECTED') return '审核拒绝'
  if (input.moderationStatus === 'VIOLATION') return '违规内容'
  if (input.publicationStatus === 'CANCELLED') return '已取消'
  if (input.publicationStatus === 'SCHEDULED') return '审核通过，等待定时发布'
  if (input.publicationStatus === 'PUBLISHED') return '已发布'
  return '等待发布'
}
