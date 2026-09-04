export const ANGEL_GIFT_BADGE_ACQUISITION_TEXT = '于「天使的礼物」执药获得'

function lines(value: string | null | undefined) {
  return (value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Compose the display copy without turning Angel Gift into a second Badge
 * rule. The Badge table still owns the original description/rule; the
 * PharmacyPrize relation is the source of truth for the additional source.
 */
export function resolveBadgeAcquisitionDescription(input: {
  storedDescription?: string | null
  generatedDescription?: string | null
  hasAngelGiftPrize?: boolean
  obtainedFromAngelGift?: boolean
}) {
  const originalLines = lines(input.storedDescription).filter((line) => line !== ANGEL_GIFT_BADGE_ACQUISITION_TEXT)
  const fallbackLines = originalLines.length ? originalLines : lines(input.generatedDescription)
  const shouldShowAngelGift = Boolean(input.hasAngelGiftPrize || input.obtainedFromAngelGift)
  const result = shouldShowAngelGift
    ? [...fallbackLines, ANGEL_GIFT_BADGE_ACQUISITION_TEXT]
    : fallbackLines
  return result.length ? result.join('\n') : null
}
