import { NextResponse } from 'next/server'
import { resolveByteRange } from '@/lib/live-photo-range'
import { canViewLivePhotoAsset } from '@/lib/live-photo-service'
import { headPrivateLivePhotoObject, readPrivateLivePhotoObject } from '@/lib/live-photo-storage'
import { isAdminRole, resolveRequestAuth } from '@/lib/security'

export async function deliverLivePhoto(request: Request, assetId: string, kind: 'cover' | 'video') {
  // These responses leave the middleware's no-store wrapper behind (the two
  // read paths are opened so approved posts stay cacheable), so every refusal
  // must opt out of caching itself. A cached 403 would otherwise outlive the
  // approval that is supposed to make the same URL readable.
  const refusal = (status: number, code: string, message: string) => NextResponse.json(
    { code, message },
    { status, headers: { 'Cache-Control': 'private, no-store, max-age=0' } },
  )
  const assetIdPattern = /^[a-zA-Z0-9_-]{8,64}$/
  if (!assetIdPattern.test(assetId)) {
    return refusal(400, 'INVALID_REQUEST', '媒体标识无效')
  }
  const auth = await resolveRequestAuth(request)
  const userId = auth.user?.id ?? null
  const privileged = !!auth.user && isAdminRole(auth.user.role)
  const asset = await canViewLivePhotoAsset(assetId, userId, privileged)
  if (!asset) {
    return refusal(403, 'FORBIDDEN', '媒体不可访问')
  }
  const key = kind === 'video' ? asset.videoKey : asset.coverKey
  if (!key) {
    return refusal(404, 'NOT_READY', '媒体仍在处理中')
  }

  let total = 0
  try {
    total = await headPrivateLivePhotoObject(key)
  } catch {
    return refusal(404, 'NOT_FOUND', '媒体资源不存在')
  }
  const range = resolveByteRange(request.headers.get('range'), total)
  if (!range) {
    return new NextResponse(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${total}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  }

  // Same rule the guard already applied, read off the relation it loaded, so a
  // second round trip cannot disagree with the access decision.
  const isPublic = asset.PostMedia.some(({ Post }) => (
    !Post.isDeleted && Post.moderationStatus === 'APPROVED' && Post.publicationStatus === 'PUBLISHED'
  ))

  /**
   * Public media used to be cached for a full year without revalidation, which
   * meant a takedown could never reach anyone who had already opened it. The route is
   * not behind a shared cache (nginx only proxies `/api`), so the browser is
   * the only stale copy — a bounded lifetime plus a validator makes that copy
   * re-check within a day, while a cheap 304 keeps repeat views fast.
   */
  const cacheControl = isPublic
    ? 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'
    : 'private, no-store, max-age=0'
  const etag = `"${assetId}-${kind}-${asset.updatedAt.getTime().toString(36)}"`
  if (isPublic && request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': cacheControl } })
  }

  const object = await readPrivateLivePhotoObject({ key, range })
  const headers = new Headers({
    'Content-Type': object.contentType,
    'Content-Length': String(object.contentLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  })
  if (object.contentRange) headers.set('Content-Range', object.contentRange)
  return new NextResponse(new Uint8Array(object.body), { status: object.status, headers })
}
