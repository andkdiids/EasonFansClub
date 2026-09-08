export type StudioReviewDecision = 'APPROVED' | 'REJECTED'
export type StudioReviewStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'

/** Public studio review follows the same reject-wins state machine as other queues. */
export function canTransitionStudioReviewStatus(from: unknown, to: unknown): from is StudioReviewStatus {
  return (from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED'))
    || (from === 'APPROVED' && to === 'REJECTED')
}
