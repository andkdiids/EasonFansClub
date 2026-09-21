import type { PharmacyDrawCount } from '@/lib/pharmacy-draw-options'

export const ANGEL_GIFT_DRAW_CONFIRMATION_STORAGE_PREFIX = 'angel-gift-confirm-suppress'

/**
 * Angel Gift uses the same confirmation preference for every draw size in one
 * campaign. A complete collection always takes precedence over the draw size;
 * otherwise only batch draws need an extra confirmation.
 */
export function shouldConfirmAngelGiftDraw(input: {
  drawCount: PharmacyDrawCount
  campaignComplete: boolean
  suppressToday: boolean
}) {
  if (input.suppressToday) return false
  return input.campaignComplete || input.drawCount > 1
}

/** The business day for this preference is always Asia/Shanghai. */
export function getAngelGiftShanghaiDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function getAngelGiftDrawConfirmationStorageKey(campaignId: string, dateKey: string) {
  return `${ANGEL_GIFT_DRAW_CONFIRMATION_STORAGE_PREFIX}:${campaignId}:${dateKey}`
}
