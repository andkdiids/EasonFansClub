import { getShanghaiDayRange } from '@/lib/checkin'

export const POST_EXPIRY_TYPES = ['TODAY', 'HOURS_24', 'DAYS_3', 'DAYS_7'] as const
export type PostExpiryType = typeof POST_EXPIRY_TYPES[number]

export const POST_EXPIRY_OPTIONS: ReadonlyArray<{ value: PostExpiryType; label: string }> = [
  { value: 'TODAY', label: '仅今日' },
  { value: 'HOURS_24', label: '24 小时' },
  { value: 'DAYS_3', label: '3 天' },
  { value: 'DAYS_7', label: '7 天' },
]

export function parsePostExpiryType(value: unknown): PostExpiryType | null {
  return typeof value === 'string' && (POST_EXPIRY_TYPES as readonly string[]).includes(value)
    ? value as PostExpiryType
    : value === null || value === undefined || value === ''
      ? null
      : null
}

/**
 * Resolve a relative user choice at the moment the post becomes public.
 * TODAY is a Shanghai natural day, not a rolling 24-hour window.
 */
export function calculatePostExpiresAt(expiryType: PostExpiryType | null, startsAt: Date): Date | null {
  if (!expiryType) return null
  if (expiryType === 'TODAY') return getShanghaiDayRange(startsAt).end
  const days = expiryType === 'HOURS_24' ? 1 : expiryType === 'DAYS_3' ? 3 : 7
  return new Date(startsAt.getTime() + days * 24 * 60 * 60 * 1000)
}

export function isPostExpired(expiresAt: Date | string | null | undefined, now = new Date()) {
  if (!expiresAt) return false
  const value = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  return !Number.isNaN(value.getTime()) && value.getTime() <= now.getTime()
}

export function buildPostExpiryWhere(now = new Date()) {
  return {
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: now } },
    ],
  }
}

/** Display-only, intentionally coarse so the browser never needs a timer/API poll. */
export function formatPostExpiry(expiresAt: Date | string | null | undefined, now = new Date()) {
  if (!expiresAt) return null
  const value = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(value.getTime())) return null
  const remainingMs = value.getTime() - now.getTime()
  if (remainingMs <= 0) return '已过期'
  const minutes = Math.ceil(remainingMs / 60_000)
  if (minutes < 60) return `还剩 ${minutes} 分钟`
  const hours = Math.ceil(minutes / 60)
  if (hours < 24) return `还剩 ${hours} 小时`
  return `还剩 ${Math.ceil(hours / 24)} 天`
}
