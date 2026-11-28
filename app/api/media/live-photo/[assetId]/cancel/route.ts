import { NextResponse } from 'next/server'
import { isAdminRole, requireRequestUser } from '@/lib/security'
import { deleteLivePhotoAsset, getOwnedAsset, LivePhotoServiceError } from '@/lib/live-photo-service'
import { deleteLivePhotoObjects } from '@/lib/live-photo-storage'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ assetId: string }> }
const assetIdPattern = /^[a-zA-Z0-9_-]{8,64}$/

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const { assetId } = await context.params
  if (!assetIdPattern.test(assetId)) return NextResponse.json({ code: 'INVALID_REQUEST', message: '媒体标识无效' }, { status: 400 })
  try {
    const asset = await getOwnedAsset(assetId, guard.user.id, isAdminRole(guard.user.role))
    if (asset.status === 'READY') return deleteLivePhotoAsset(assetId, guard.user.id, isAdminRole(guard.user.role))
    await prisma.livePhotoAsset.update({ where: { id: assetId }, data: { status: 'CANCELLED', stage: 'cancelled' } })
    const prefix = asset.sourceCoverKey.replace(/\/source-cover$/, '')
    await deleteLivePhotoObjects([
      asset.sourceCoverKey, asset.sourceVideoKey,
      `${prefix}/cover.webp`, `${prefix}/thumb.webp`, `${prefix}/video.mp4`,
    ])
    return NextResponse.json({ id: assetId, cancelled: true })
  } catch (error) {
    if (error instanceof LivePhotoServiceError) {
      return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    }
    return NextResponse.json({ code: 'UNKNOWN', message: '取消上传失败' }, { status: 503 })
  }
}
