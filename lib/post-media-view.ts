import { publicImageUrl } from '@/lib/images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import {
  livePhotoAssetIdForRecord,
  mapPostMediaRows,
  toPostMediaDisplayItem as toPostMediaDisplayItemWithResolver,
  type PostMediaDisplayItem,
  type PostMediaRecordShape,
  type PostMediaUrlResolver,
} from '@/lib/post-media-core'

export { POST_MEDIA_VISIBLE_TYPES } from '@/lib/post-media-core'
export type {
  PostMediaDisplayItem,
  PostMediaDisplayType,
  PostMediaRecordShape,
  PostMediaVisibleType,
} from '@/lib/post-media-core'

/** Older call sites used this name for the stored row shape. */
export type PostMediaDisplayRecord = PostMediaRecordShape

export function livePhotoCoverUrl(assetId: string) {
  return `/api/media/live-photo/${assetId}/cover`
}

export function livePhotoVideoUrl(assetId: string) {
  return `/api/media/live-photo/${assetId}/video`
}

export function livePhotoIdForMedia(record: Pick<PostMediaRecordShape, 'url' | 'thumbnail' | 'livePhotoId'>) {
  return livePhotoAssetIdForRecord(record)
}

/** The project's media URL rules, injected into the shared pure mapper. */
const postMediaUrlResolver: PostMediaUrlResolver = {
  cover: (raw) => publicImageUrl(raw),
  thumbnail: (raw) => publicImageVariantUrl(raw, 'card') || publicImageUrl(raw),
  video: (assetId) => livePhotoVideoUrl(assetId),
}

export function toPostMediaDisplayItem(record: PostMediaRecordShape): PostMediaDisplayItem | null {
  return toPostMediaDisplayItemWithResolver(record, postMediaUrlResolver)
}

/** Map a post's media rows once, for every renderer. */
export function toPostMediaDisplayItems(records: readonly PostMediaRecordShape[]): PostMediaDisplayItem[] {
  return mapPostMediaRows(records, postMediaUrlResolver)
}

/** First visible medium, used for share and poster cards. */
export function firstPostMediaDisplayItem(records: readonly PostMediaRecordShape[]) {
  return toPostMediaDisplayItems(records)[0] ?? null
}
