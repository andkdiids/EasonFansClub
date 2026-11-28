import { NextResponse } from 'next/server'
import { isAdminRole, requireRequestUser } from '@/lib/security'
import { convertLivePhotoCoverToPublicImage, convertPostMediaToImage } from '@/lib/live-photo-convert'
import { LivePhotoServiceError } from '@/lib/live-photo-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ assetId: string }> }
const assetIdPattern = /^[a-zA-Z0-9_-]{8,64}$/
const postMediaIdPattern = /^[a-zA-Z0-9_-]{1,64}$/

/**
 * Turn a live photo into an ordinary image ("关闭实况效果"). The cover is
 * re-encoded into the public content image family, so the resulting URL keeps
 * working for visitors, old clients and CDN caching.
 *
 * `postMediaId` converts an already-published row in place (edit flow); without
 * it the call only returns a public URL for the composer to swap in.
 */
export async function POST(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { assetId } = await context.params
  if (!assetIdPattern.test(assetId)) {
    return NextResponse.json({ code: 'INVALID_REQUEST', message: '媒体标识无效' }, { status: 400 })
  }
  const body = await request.json().catch(() => ({} as { postMediaId?: unknown }))
  const postMediaId = typeof body?.postMediaId === 'string' && postMediaIdPattern.test(body.postMediaId) ? body.postMediaId : null
  const isAdmin = isAdminRole(guard.user.role)
  try {
    if (postMediaId) {
      const result = await convertPostMediaToImage({ postMediaId, userId: guard.user.id, isAdmin })
      return NextResponse.json(result)
    }
    const result = await convertLivePhotoCoverToPublicImage(assetId, guard.user.id, isAdmin)
    return NextResponse.json({ url: result.url, width: result.width, height: result.height })
  } catch (error) {
    if (error instanceof LivePhotoServiceError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    }
    console.warn('[live-photo.convert]', { assetId })
    return NextResponse.json({ code: 'CONVERT_FAILED', message: '转换失败，请稍后重试' }, { status: 502 })
  }
}
