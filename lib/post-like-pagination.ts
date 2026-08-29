export const POST_LIKE_PAGE_SIZE = 50

export type PostLikeCursor = {
  createdAt: string
  id: string
}

export function encodePostLikeCursor(cursor: PostLikeCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

export function decodePostLikeCursor(value: string | null | undefined): PostLikeCursor | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<PostLikeCursor>
    const createdAt = new Date(String(decoded.createdAt || ''))
    if (!decoded.id || !/^[a-zA-Z0-9_-]{1,191}$/.test(decoded.id) || !Number.isFinite(createdAt.getTime())) return null
    return { id: decoded.id, createdAt: createdAt.toISOString() }
  } catch {
    return null
  }
}
