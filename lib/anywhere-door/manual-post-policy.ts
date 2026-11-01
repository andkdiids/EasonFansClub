export const MANUAL_POST_CREATE_RATE_LIMIT_POLICY = {
  endpoint: '/api/admin/anywhere-door/posts/manual:POST',
  ip: { limit: 30, windowSeconds: 60 * 60 },
  user: { limit: 20, windowSeconds: 60 * 60 },
} as const

export const MANUAL_POST_DELETE_RATE_LIMIT_POLICY = {
  endpoint: '/api/admin/anywhere-door/posts/manual/:postId:DELETE',
  ip: { limit: 30, windowSeconds: 60 * 60 },
  user: { limit: 20, windowSeconds: 60 * 60 },
} as const

export const MANUAL_POST_RECORDS_PAGE_SIZE = 20

export function isRecoverableManualPostMatch(post: { status: string; mediaCount: number }) {
  return post.status === 'FAILED' && post.mediaCount === 0
}
