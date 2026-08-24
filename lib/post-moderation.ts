export const postModerationStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'VIOLATION'] as const
export const POST_REVIEW_PAGE_SIZE = 50

export type PostModerationStatus = typeof postModerationStatuses[number]
export type PostModerationAccess = 'VISIBLE' | 'PENDING' | 'REJECTED'

const publicPostModerationStatuses: PostModerationStatus[] = ['APPROVED', 'VIOLATION']

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
 * preview path) may additionally see pending posts, but a rejected post must
 * never become a normal profile record again.
 */
export function buildProfilePostWhere(authorId: string, includePending = false) {
  return {
    ...publicPostWhere,
    authorId,
    ...(includePending
      ? { moderationStatus: { in: ['PENDING', ...publicPostModerationStatuses] as PostModerationStatus[] } }
      : {}),
  }
}
