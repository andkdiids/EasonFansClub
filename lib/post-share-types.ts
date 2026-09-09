export const POST_SHARE_MESSAGE_TYPE = 'POST_SHARE' as const
export const POST_SHARE_UNAVAILABLE_TITLE = '该帖子已不存在或暂不可查看'

export type PostShareSnapshot = Readonly<{
  postId: string
  title: string
  summary: string
  authorName: string
  boardName: string
  imageUrl: string | null
}>

export type PostShareMessageView = PostShareSnapshot & Readonly<{
  url: string
  available: boolean
}>

function optionalString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function parsePostShareSnapshot(value: unknown): PostShareSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const postId = optionalString(record.postId, 191)
  const title = optionalString(record.title, 120)
  if (!postId || !title) return null
  const imageUrl = typeof record.imageUrl === 'string' && record.imageUrl.trim()
    ? record.imageUrl.trim().slice(0, 1000)
    : null
  return {
    postId,
    title,
    summary: optionalString(record.summary, 180),
    authorName: optionalString(record.authorName, 80),
    boardName: optionalString(record.boardName, 80),
    imageUrl,
  }
}

export function postSharePreview(snapshot: Pick<PostShareSnapshot, 'title'>) {
  return `[帖子] ${snapshot.title || '分享了一个帖子'}`
}

export function postShareUrl(postId: string) {
  return `/posts/${encodeURIComponent(postId)}`
}
