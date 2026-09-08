export type SalonReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

/**
 * Approval is a one-way transition, while rejection may also revoke a
 * previously approved public submission. Rejected submissions are not
 * reopened by this workflow.
 */
export function canTransitionSalonReviewStatus(from: unknown, to: unknown): from is SalonReviewStatus {
  return (from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED'))
    || (from === 'APPROVED' && to === 'REJECTED')
}
