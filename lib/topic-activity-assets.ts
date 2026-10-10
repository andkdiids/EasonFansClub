import { getSignedCosObjectUrl } from '@/lib/tencent-cos'
import { imageVariantObjectPath } from '@/lib/image-variants'
import { isTopicActivityOriginalObjectKey, topicActivityPreviewObjectPath } from '@/lib/topic-activity-image-original'
import { topicActivityAssetPreviewUrl, topicActivityPreviewObjectPathForAsset, type TopicActivityPreviewVariant } from '@/lib/topic-activity-image-preview'

export type TopicActivityAssetRecord = {
  id: string
  storageKey: string
  mimeType: string
  width: number
  height: number
  size: number
  /** Present on the upload response; persisted rows may supply it via context. */
  activityId?: string
  purpose?: 'FORM_ANSWER' | 'ADMIN_REPLY'
}

export type TopicActivityAssetDownloadContext =
  | { activityId: string; submissionId: string; purpose: 'FORM_ANSWER' }
  | { activityId: string; submissionId: string; purpose: 'ADMIN_REPLY'; replyId: string }

type TopicActivityAssetAccessFields = {
  previewAccessUrl?: string
  thumbnailAccessUrl?: string
}

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

function stablePreviewUrl(
  asset: TopicActivityAssetRecord,
  downloadContext: TopicActivityAssetDownloadContext | undefined,
  variant: TopicActivityPreviewVariant,
) {
  const activityId = downloadContext?.activityId || asset.activityId
  const purpose = downloadContext?.purpose || asset.purpose
  if (!activityId || !purpose || !topicActivityPreviewObjectPathForAsset(asset.storageKey, activityId, purpose, variant)) return null
  return topicActivityAssetPreviewUrl(activityId, asset.id, variant)
}

export function serializeTopicActivityAsset(asset: TopicActivityAssetRecord, downloadContext?: TopicActivityAssetDownloadContext) {
  const previewKey = displayObjectKey(asset.storageKey, 'preview')
  const thumbnailKey = displayObjectKey(asset.storageKey, 'thumbnail')
  const hasOriginal = Boolean(downloadContext && isTopicActivityOriginalObjectKey(asset.storageKey, downloadContext.activityId, downloadContext.purpose))
  const previewAccessUrl = stablePreviewUrl(asset, downloadContext, 'preview')
  const thumbnailAccessUrl = stablePreviewUrl(asset, downloadContext, 'thumbnail')
  const accessFields: TopicActivityAssetAccessFields = {
    ...(previewAccessUrl ? { previewAccessUrl } : {}),
    ...(thumbnailAccessUrl ? { thumbnailAccessUrl } : {}),
  }
  return {
    assetId: asset.id,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    // Keep the historical absolute signed fields for Mobile and other clients
    // that load the URL directly. Web uses the additive same-origin access
    // fields below so an expired COS signature can be renewed by asset ID.
    url: getSignedCosObjectUrl(previewKey, 300),
    thumbnailUrl: getSignedCosObjectUrl(thumbnailKey, 300),
    ...accessFields,
    ...(hasOriginal && downloadContext ? { originalDownloadUrl: topicActivityOriginalDownloadUrl(downloadContext, asset.id) } : {}),
  }
}
