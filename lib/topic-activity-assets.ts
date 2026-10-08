import { getSignedCosObjectUrl } from '@/lib/tencent-cos'
import { imageVariantObjectPath } from '@/lib/image-variants'
import { isTopicActivityOriginalObjectKey, topicActivityPreviewObjectPath } from '@/lib/topic-activity-image-original'

export type TopicActivityAssetRecord = {
  id: string
  storageKey: string
  mimeType: string
  width: number
  height: number
  size: number
}

export type TopicActivityAssetDownloadContext =
  | { activityId: string; submissionId: string; purpose: 'FORM_ANSWER' }
  | { activityId: string; submissionId: string; purpose: 'ADMIN_REPLY'; replyId: string }

export function topicActivityOriginalDownloadUrl(context: TopicActivityAssetDownloadContext, assetId: string) {
  const base = `/api/activities/${encodeURIComponent(context.activityId)}/form-submissions/${encodeURIComponent(context.submissionId)}`
  if (context.purpose === 'FORM_ANSWER') return `${base}/assets/${encodeURIComponent(assetId)}/original`
  return `${base}/replies/${encodeURIComponent(context.replyId)}/assets/${encodeURIComponent(assetId)}/original`
}

function displayObjectKey(storageKey: string, variant: 'preview' | 'thumbnail') {
  const topicKey = topicActivityPreviewObjectPath(storageKey, variant)
  if (topicKey) return topicKey
  if (variant === 'thumbnail') {
    try { return imageVariantObjectPath(storageKey, 'thumb-md') } catch { /* legacy key may not have a variant family */ }
  }
  return storageKey
}

export function serializeTopicActivityAsset(asset: TopicActivityAssetRecord, downloadContext?: TopicActivityAssetDownloadContext) {
  const previewKey = displayObjectKey(asset.storageKey, 'preview')
  const thumbnailKey = displayObjectKey(asset.storageKey, 'thumbnail')
  const hasOriginal = Boolean(downloadContext && isTopicActivityOriginalObjectKey(asset.storageKey, downloadContext.activityId, downloadContext.purpose))
  return {
    assetId: asset.id,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    // Both browser-facing URLs point at independent private derivatives. The
    // original is available only through the authenticated download route.
    url: getSignedCosObjectUrl(previewKey, 300),
    thumbnailUrl: getSignedCosObjectUrl(thumbnailKey, 300),
    ...(hasOriginal && downloadContext ? { originalDownloadUrl: topicActivityOriginalDownloadUrl(downloadContext, asset.id) } : {}),
  }
}
