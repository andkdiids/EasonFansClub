export type AngelGiftPrizePreviewInput = {
  id: string
  weight: string | number
  enabled: boolean
}

export type AngelGiftPrizePreviewRow = {
  id: string
  parsedWeight: number | null
  validWeight: boolean
  probability: number
}

export type AngelGiftPrizePreview = {
  totalWeight: number
  rows: AngelGiftPrizePreviewRow[]
}

/** Admin-only validation for the integer weight field. */
export function parseAngelGiftPositiveInteger(value: string | number) {
  const text = typeof value === 'number' ? String(value) : value.trim()
  if (!text || !/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * Calculates a display-only preview. The result is never used by the draw
 * service; the server remains the only authority for an actual draw.
 */
export function calculateAngelGiftPrizePreview(prizes: AngelGiftPrizePreviewInput[]): AngelGiftPrizePreview {
  const parsedRows = prizes.map((prize) => ({
    id: prize.id,
    parsedWeight: parseAngelGiftPositiveInteger(prize.weight),
    enabled: prize.enabled,
  }))
  const totalWeight = parsedRows.reduce((sum, prize) => sum + (prize.enabled && prize.parsedWeight !== null ? prize.parsedWeight : 0), 0)
  return {
    totalWeight,
    rows: parsedRows.map((prize) => ({
      id: prize.id,
      parsedWeight: prize.parsedWeight,
      validWeight: prize.parsedWeight !== null,
      probability: prize.enabled && prize.parsedWeight !== null && totalWeight > 0
        ? (prize.parsedWeight / totalWeight) * 100
        : 0,
    })),
  }
}
