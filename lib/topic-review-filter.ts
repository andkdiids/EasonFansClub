export type TopicReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN'
export type TopicReviewCounts = Record<TopicReviewStatus, number> & { ALL?: number }
export const topicVisibleReplyAuthor = { User: { status: 'ACTIVE' as const, isDeleted: false, Profile: { isNot: null } } }

export function topicReviewFilter(activityId?: string | null, status?: TopicReviewStatus | null) {
  // Ownership is handled by the separate "my comments" shortcut, never an
  // OR exception in an administrative status query.
  return activityId && status ? { TopicActivitySubmission: { is: { activityId, status } } } : {}
}

export function matchesTopicReviewFilter(reply: { topicActivitySubmission?: { status: TopicReviewStatus } }, filter: TopicReviewStatus | 'ALL') {
  return filter === 'ALL' || reply.topicActivitySubmission?.status === filter
}

export function topicReviewCountForFilter(counts: TopicReviewCounts, filter: TopicReviewStatus | 'ALL') {
  return filter === 'ALL' ? counts.ALL ?? (counts.PENDING + counts.APPROVED + counts.REJECTED + counts.WITHDRAWN) : counts[filter]
}

export function topicReviewCountsFromGroups(rows: Array<{ status: string; _count: { _all: number } }>, totalRoots?: number): TopicReviewCounts {
  const counts: TopicReviewCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0, WITHDRAWN: 0 }
  for (const row of rows) if (row.status in counts) counts[row.status as TopicReviewStatus] = row._count._all
  // ALL includes ordinary/historical roots without a Submission, too.
  return totalRoots === undefined ? counts : { ...counts, ALL: totalRoots }
}
