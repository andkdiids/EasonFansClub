import type { MusicPublicationStatus, Prisma } from '@prisma/client'
import { sanitizeText } from '@/lib/security'

export const MAX_ALBUM_REVIEW_IMAGES = 12

export function parseAlbumReviewImages(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => sanitizeText(item, 1000))
    .filter((item, index, items) => Boolean(item) && items.indexOf(item) === index)
    .slice(0, MAX_ALBUM_REVIEW_IMAGES)
}

export function readAlbumReviewImages(value: Prisma.JsonValue) {
  return parseAlbumReviewImages(value)
}

export function parseAlbumReviewStatus(value: unknown): MusicPublicationStatus {
  return value === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'
}

export function albumReviewPublishedAt(
  status: MusicPublicationStatus,
  current: Date | null = null,
) {
  return status === 'PUBLISHED' ? current || new Date() : null
}
