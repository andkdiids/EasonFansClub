export const postModerationStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const

export type PostModerationStatus = typeof postModerationStatuses[number]
export type PostModerationAccess = 'VISIBLE' | 'PENDING' | 'REJECTED'

/**
 * The moderation state is deliberately separate from Post.status.
 * Post.status describes the publication lifecycle; this type describes review.
 */
export function isPostModerationStatus(value: unknown): value is PostModerationStatus {
  return postModerationStatuses.includes(value as PostModerationStatus)
}

export function buildPostReviewUpdate({
  status,
  reviewedAt,
  reviewedById,
  rejectionReason,
}: {
  status: Exclude<PostModerationStatus, 'PENDING'>
  reviewedAt: Date
  reviewedById: string
  rejectionReason: string | null
}) {
  return {
    moderationStatus: status,
    reviewedAt,
    reviewedById,
    // An approval must never retain a stale rejection reason.
    rejectionReason: status === 'REJECTED' ? rejectionReason : null,
  } as const
}

export function getPostModerationAccess(status: PostModerationStatus, viewerIsAdmin: boolean): PostModerationAccess {
  if (viewerIsAdmin || status === 'APPROVED') return 'VISIBLE'
  return status
}

/** Shared filter for every ordinary-user-facing post query. */
export const publicPostWhere = {
  isDeleted: false,
  status: 'PUBLISHED' as const,
  moderationStatus: 'APPROVED' as const,
}
