import { getSignedCosObjectUrl } from '@/lib/tencent-cos'
import { imageVariantObjectPath } from '@/lib/image-variants'

export type TopicActivityAssetRecord = {
  id: string
  storageKey: string
  mimeType: string
  width: number
  height: number
  size: number
}

export function serializeTopicActivityAsset(asset: TopicActivityAssetRecord) {
  return {
    assetId: asset.id,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    size: asset.size,
    url: getSignedCosObjectUrl(asset.storageKey, 300),
    thumbnailUrl: getSignedCosObjectUrl(imageVariantObjectPath(asset.storageKey, 'thumb-md'), 300),
  }
}
