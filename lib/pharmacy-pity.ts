import { ALLOWED_PHARMACY_DRAW_COUNTS, type PharmacyDrawCount } from '@/lib/pharmacy-draw-options'

export type { PharmacyDrawCount } from '@/lib/pharmacy-draw-options'

export type PharmacyPityCandidate = {
  id: string
  type: string
  badgeId: string | null
  isHidden: boolean
  weight: number
}

export function parsePharmacyDrawCount(value: unknown): PharmacyDrawCount | null {
  const parsed = typeof value === 'number' && Number.isSafeInteger(value) ? value : NaN
  return ALLOWED_PHARMACY_DRAW_COUNTS.includes(parsed as PharmacyDrawCount) ? parsed as PharmacyDrawCount : null
}

export function shouldUsePharmacyPity(input: {
  enabled: boolean
  threshold: number | null | undefined
  pityCount: number
  candidateCount: number
}) {
  const threshold = input.threshold ?? 0
  return input.enabled && threshold > 0 && input.pityCount + 1 >= threshold && input.candidateCount > 0
}

export function advancePharmacyPityCount(current: number, usedPity: boolean) {
  return usedPity ? 0 : Math.max(0, current) + 1
}

export function selectPharmacyPityCandidates<T extends PharmacyPityCandidate>(
  prizes: readonly T[],
  activeOwnedBadgeIds: ReadonlySet<string>,
  includeHidden: boolean,
  collectionRewardBadgeId: string | null | undefined,
) {
  return prizes.filter((prize) =>
    prize.type === 'BADGE'
    && Boolean(prize.badgeId)
    && !activeOwnedBadgeIds.has(prize.badgeId as string)
    && (includeHidden || !prize.isHidden)
    && prize.badgeId !== collectionRewardBadgeId
    && prize.weight > 0,
  )
}
