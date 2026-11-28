import { NextResponse } from 'next/server'
import { isAdminRole, requireRequestUser } from '@/lib/security'
import { deleteLivePhotoAsset, getOwnedAsset, livePhotoAssetView, LivePhotoServiceError } from '@/lib/live-photo-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ assetId: string }> }
const assetIdPattern = /^[a-zA-Z0-9_-]{8,64}$/

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { assetId } = await context.params
  if (!assetIdPattern.test(assetId)) return NextResponse.json({ code: 'INVALID_REQUEST', message: '媒体标识无效' }, { status: 400 })
  try {
    const asset = await getOwnedAsset(assetId, guard.user.id, isAdminRole(guard.user.role))
    return NextResponse.json({ asset: livePhotoAssetView(asset) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof LivePhotoServiceError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ code: 'UNKNOWN', message: '读取媒体状态失败' }, { status: 503 })
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { assetId } = await context.params
  if (!assetIdPattern.test(assetId)) return NextResponse.json({ code: 'INVALID_REQUEST', message: '媒体标识无效' }, { status: 400 })
  try {
    const result = await deleteLivePhotoAsset(assetId, guard.user.id, isAdminRole(guard.user.role))
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof LivePhotoServiceError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ code: 'UNKNOWN', message: '删除媒体失败' }, { status: 503 })
  }
}
