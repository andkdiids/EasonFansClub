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

/**
 * The normal admin review state machine is intentionally one-way at the
 * decision boundary: a pending post may be approved or rejected, and an
 * approved post may be revoked. Rejected is absorbing so a stale approve
 * request can never reopen it.
 */
export function canTransitionPostModerationStatus(from: unknown, to: unknown): from is PostReviewableStatus {
  return (from === 'PENDING' && (to === 'APPROVED' || to === 'REJECTED'))
    || (from === 'APPROVED' && to === 'REJECTED')
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
 * The canonical fact used by growth actions that require a valid published
 * post. A pending, rejected, deleted, draft, or moderation-violation post is
 * not an effective publication for reward purposes. This deliberately reads
 * the persisted public state, so review-bypass authors follow the same path
 * as ordinary authors once their post is public.
 */
export function isQualifiedPublishedPost(post: {
  status: unknown
  moderationStatus: unknown
  isDeleted: unknown
}) {
  return post.isDeleted === false && post.status === 'PUBLISHED' && post.moderationStatus === 'APPROVED'
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
