import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { deleteFromCos } from '@/lib/tencent-cos'
import { publicImageUrl } from '@/lib/images'
import { createImageVariants } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { uploadSiteImage } from '@/lib/site-media-storage'
import { readPrivateLivePhotoObject } from '@/lib/live-photo-storage'
import { getOwnedAsset, LivePhotoServiceError } from '@/lib/live-photo-service'

// Same normalization a normal content upload uses, so the result is
// indistinguishable from a regular post image (variants included).
const CONTENT_IMAGE_MAX_WIDTH = 1600
const CONTENT_IMAGE_QUALITY = 82

/**
 * "关闭实况效果" must produce a real standalone image: the private cover cannot
 * be referenced by a plain IMAGE row because visitors are not allowed to read a
 * guarded live photo object. So the cover is re-encoded into the same public
 * object family a normal content upload uses.
 */
export async function convertLivePhotoCoverToPublicImage(assetId: string, userId: string, isAdmin = false) {
  const asset = await getOwnedAsset(assetId, userId, isAdmin)
  if (asset.status !== 'READY' || !asset.coverKey) {
    throw new LivePhotoServiceError('NOT_READY', '实况照片仍在处理中，请稍后再试', 409)
  }
  const cover = await readPrivateLivePhotoObject({ key: asset.coverKey, range: null })
  const objectPath = `content/${asset.ownerId}/${randomUUID()}/source.webp`
  const generated = await createImageVariants(cover.body, {
    sourceMaxWidth: CONTENT_IMAGE_MAX_WIDTH,
    sourceQuality: CONTENT_IMAGE_QUALITY,
    variants: ['thumb-md', 'card', 'large'],
  })
  const result = await uploadImageVariantFamily({
    sourceObjectPath: objectPath,
    original: cover.body,
    preserveOriginal: false,
    originalContentType: 'image/webp',
    generated,
    upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    remove: deleteFromCos,
  })
  const url = publicImageUrl(result.sourceUrl)
  if (!url) throw new LivePhotoServiceError('CONVERT_FAILED', '转换失败，请稍后重试', 502)
  return { url, width: asset.width, height: asset.height }
}

/**
 * Convert an already-published post media row in place. The row keeps its id so
 * `keepMediaIds` from the edit form stays valid and the post never loses media.
 */
export async function convertPostMediaToImage(params: {
  postMediaId: string
  userId: string
  isAdmin?: boolean
}) {
  const media = await prisma.postMedia.findUnique({
    where: { id: params.postMediaId },
    select: {
      id: true, type: true, livePhotoId: true,
      Post: { select: { authorId: true } },
    },
  })
  if (!media || media.type !== 'LIVE_PHOTO' || !media.livePhotoId) {
    throw new LivePhotoServiceError('ASSET_NOT_FOUND', '该媒体不是实况照片', 404)
  }
  if (!params.isAdmin && media.Post.authorId !== params.userId) {
    throw new LivePhotoServiceError('FORBIDDEN', '无权修改该媒体', 403)
  }
  const asset = await getOwnedAsset(media.livePhotoId, params.userId, params.isAdmin)
  if (asset.ownerId !== media.Post.authorId && !params.isAdmin) {
    throw new LivePhotoServiceError('FORBIDDEN', '无权修改该媒体', 403)
  }
  const converted = await convertLivePhotoCoverToPublicImage(media.livePhotoId, asset.ownerId, true)
  await prisma.postMedia.update({
    where: { id: media.id },
    data: { type: 'IMAGE', url: converted.url, thumbnail: null, livePhotoId: null },
  })
  return { ...converted, postMediaId: media.id }
}
