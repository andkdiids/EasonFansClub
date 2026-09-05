export const postModerationStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'VIOLATION'] as const
export const postReviewableStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const
export const POST_REVIEW_PAGE_SIZE = 50

export type PostModerationStatus = typeof postModerationStatuses[number]
export type PostReviewableStatus = typeof postReviewableStatuses[number]
export type PostModerationAccess = 'VISIBLE' | 'PENDING' | 'REJECTED'

const publicPostModerationStatuses: PostModerationStatus[] = ['APPROVED', 'VIOLATION']

/**
 * The moderation state is deliberately separate from Post.status.
 * Post.status describes the publication lifecycle; this type describes review.
 */
export function isPostModerationStatus(value: unknown): value is PostModerationStatus {
  return postModerationStatuses.includes(value as PostModerationStatus)
}

/** Statuses that an administrator may move through the normal review flow. */
export function isPostReviewableStatus(value: unknown): value is PostReviewableStatus {
  return postReviewableStatuses.includes(value as PostReviewableStatus)
}

export function isPublicPostModerationStatus(value: unknown): value is PostModerationStatus {
  return publicPostModerationStatuses.includes(value as PostModerationStatus)
}

/** The normal admin review endpoint may target either final state from any
 * persisted review state, while VIOLATION remains a separate moderation path. */
export function canTransitionPostModerationStatus(from: unknown, to: unknown): from is PostReviewableStatus {
  return isPostReviewableStatus(from) && (to === 'APPROVED' || to === 'REJECTED')
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

export function getPostModerationAccess(
  status: PostModerationStatus,
  viewerIsAdmin: boolean,
  viewerIsAuthor = false,
): PostModerationAccess {
  if (viewerIsAdmin || viewerIsAuthor || status === 'APPROVED' || status === 'VIOLATION') return 'VISIBLE'
  return status
}

/** Shared filter for every ordinary-user-facing post query. */
export const publicPostWhere = {
  isDeleted: false,
  status: 'PUBLISHED' as const,
  moderationStatus: { in: publicPostModerationStatuses },
}

/**
 * Profile post history uses the same public lifecycle filter as every other
 * ordinary-user-facing post query. The profile owner (and the existing admin
 * preview path) may additionally see their moderation-private pending and
 * rejected posts; the caller only enables this branch for that trusted viewer.
 */
export function buildProfilePostWhere(authorId: string, includePending = false) {
  return {
    ...publicPostWhere,
    authorId,
    ...(includePending
      ? { moderationStatus: { in: ['PENDING', 'REJECTED', ...publicPostModerationStatuses] as PostModerationStatus[] } }
      : {}),
  }
}
