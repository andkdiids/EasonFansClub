export type TodayReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/**
 * Review decisions are monotonic. REJECTED is the terminal winner when two
 * administrators act on the same row, while APPROVED may still be revoked by
 * a later explicit rejection.
 */
export function canTransitionTodayReviewStatus(from: string, to: TodayReviewStatus) {
  return (from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED'))
    || (from === 'APPROVED' && to === 'REJECTED')
}
