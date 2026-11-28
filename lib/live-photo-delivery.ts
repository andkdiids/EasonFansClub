import { NextResponse } from 'next/server'
import { resolveByteRange } from '@/lib/live-photo-range'
import { canViewLivePhotoAsset, isLivePhotoPublic } from '@/lib/live-photo-service'
import { headPrivateLivePhotoObject, readPrivateLivePhotoObject } from '@/lib/live-photo-storage'
import { isAdminRole, resolveRequestAuth } from '@/lib/security'

export async function deliverLivePhoto(request: Request, assetId: string, kind: 'cover' | 'video') {
  const assetIdPattern = /^[a-zA-Z0-9_-]{8,64}$/
  if (!assetIdPattern.test(assetId)) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: '媒体标识无效' }, { status: 400 })
  }
  const auth = await resolveRequestAuth(request)
  const userId = auth.user?.id ?? null
  const privileged = !!auth.user && isAdminRole(auth.user.role)
  const asset = await canViewLivePhotoAsset(assetId, userId, privileged)
  if (!asset) {
    return NextResponse.json({ code: 'FORBIDDEN', message: '媒体不可访问' }, { status: 403 })
  }
  const key = kind === 'video' ? asset.videoKey : asset.coverKey
  if (!key) {
    return NextResponse.json({ code: 'NOT_READY', message: '媒体仍在处理中' }, { status: 404 })
  }

  let total = 0
  try {
    total = await headPrivateLivePhotoObject(key)
  } catch {
    return NextResponse.json({ code: 'NOT_FOUND', message: '媒体资源不存在' }, { status: 404 })
  }
  const range = resolveByteRange(request.headers.get('range'), total)
  if (!range) {
    return new NextResponse(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${total}`, 'Accept-Ranges': 'bytes' },
    })
  }

  const object = await readPrivateLivePhotoObject({ key, range })
  const isPublic = await isLivePhotoPublic(assetId)
  const headers = new Headers({
    'Content-Type': object.contentType,
    'Content-Length': String(object.contentLength),
    'Accept-Ranges': 'bytes',
    'Cache-Control': isPublic ? 'public, max-age=31536000, immutable' : 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
  })
  if (object.contentRange) headers.set('Content-Range', object.contentRange)
  return new NextResponse(new Uint8Array(object.body), { status: object.status, headers })
}
