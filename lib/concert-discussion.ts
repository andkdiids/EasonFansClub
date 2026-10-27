import { PUBLIC_COS_HOST, toStoredMediaUrl } from '@/lib/media-url'
import { sanitizeTextPreservingLength } from '@/lib/text'

export const CONCERT_DISCUSSION_PAGE_SIZE = 20
export const CONCERT_DISCUSSION_MAX_TEXT_LENGTH = 3000
export const CONCERT_DISCUSSION_MAX_IMAGES = 4

export type ConcertDiscussionInput = {
  content: string
  imageUrls: string[]
  requestId: string
}

export type ConcertDiscussionInputResult =
  | { ok: true; value: ConcertDiscussionInput }
  | { ok: false; message: string }

export function isConcertDiscussionRequestId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

/**
 * Discussion images must be normalized source objects uploaded by the same
 * authenticated account through /api/uploads/content-image. Arbitrary COS or
 * third-party URLs and image variants are not accepted as comment attachments.
 */
export function normalizeOwnedConcertDiscussionImageUrl(value: unknown, userId: string): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || !userId) return null
  const stored = toStoredMediaUrl(value.trim())
  if (!stored) return null

  try {
    const parsed = new URL(stored)
    if (parsed.protocol !== 'https:' || parsed.hostname.toLowerCase() !== PUBLIC_COS_HOST
      || parsed.username || parsed.password || parsed.search || parsed.hash) return null

    const segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment))
    if (segments.length !== 4 || segments[0] !== 'content' || segments[1] !== userId
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segments[2])
      || segments[3] !== 'source.webp') return null
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return null
  }
}

export function parseConcertDiscussionInput(value: unknown, userId: string): ConcertDiscussionInputResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, message: '评论内容格式无效' }
  const input = value as Record<string, unknown>
  if (!isConcertDiscussionRequestId(input.requestId)) return { ok: false, message: '提交编号无效，请重试' }
  if (typeof input.content !== 'string') return { ok: false, message: '评论内容格式无效' }
  const content = sanitizeTextPreservingLength(input.content).trim()
  if ([...content].length > CONCERT_DISCUSSION_MAX_TEXT_LENGTH) return { ok: false, message: `评论不能超过 ${CONCERT_DISCUSSION_MAX_TEXT_LENGTH} 个字符` }

  if (input.imageUrls !== undefined && !Array.isArray(input.imageUrls)) return { ok: false, message: '图片列表格式无效' }
  const rawImages = (input.imageUrls ?? []) as unknown[]
  if (rawImages.length > CONCERT_DISCUSSION_MAX_IMAGES) return { ok: false, message: `最多上传 ${CONCERT_DISCUSSION_MAX_IMAGES} 张图片` }
  const imageUrls: string[] = []
  for (const raw of rawImages) {
    const normalized = normalizeOwnedConcertDiscussionImageUrl(raw, userId)
    if (!normalized) return { ok: false, message: '评论图片无效，请重新上传' }
    imageUrls.push(normalized)
  }
  if (!content && imageUrls.length === 0) return { ok: false, message: '请填写评论或上传图片' }

  return { ok: true, value: { content, imageUrls, requestId: input.requestId } }
}

/**
 * Nullable showId is the stable discriminator: null is the event-wide room;
 * a concrete id is a separate room. The API additionally verifies the show
 * belongs to the event before using this filter.
 */
export function concertDiscussionScopeWhere(eventId: string, showId: string | null) {
  return { eventId, showId }
}

export function matchesConcertDiscussionIdempotency(
  existing: { eventId: string; showId: string | null; content: string; images: Array<{ url: string }> },
  input: ConcertDiscussionInput,
  eventId: string,
  showId: string | null,
) {
  return existing.eventId === eventId
    && existing.showId === showId
    && existing.content === input.content
    && existing.images.length === input.imageUrls.length
    && existing.images.every((image, index) => image.url === input.imageUrls[index])
}
