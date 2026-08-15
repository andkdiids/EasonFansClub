import { NextResponse } from 'next/server'
import { deleteOwnMyLivePhoto, MyLivePhotoRequestError, reorderOwnMyLivePhotos } from '@/lib/my-live-photos'
import { PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ attendanceId: string; photoId: string }> }

function errorResponse(error: unknown) {
  if (error instanceof MyLivePhotoRequestError) {
    return NextResponse.json({ message: error.message }, { status: error.status, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }
  console.error('[music.live.photo.mutation]', error instanceof Error ? error.message : error)
  return NextResponse.json({ message: '照片操作失败，请稍后重试' }, { status: 500, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}

export async function DELETE(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return withPersonalNoStore(originError)
  const { attendanceId, photoId } = await params
  try {
    await deleteOwnMyLivePhoto(guard.user.id, attendanceId, photoId)
    return NextResponse.json({ ok: true, photoId }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return withPersonalNoStore(originError)
  const body = await request.json().catch(() => null)
  const direction = body && typeof body === 'object' && !Array.isArray(body) ? body.direction : undefined
  if (direction !== 'previous' && direction !== 'next') {
    return NextResponse.json({ message: '排序方向无效' }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }
  const { attendanceId, photoId } = await params
  try {
    const photos = await reorderOwnMyLivePhotos(guard.user.id, attendanceId, photoId, direction)
    return NextResponse.json({ attendanceId, photos }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  } catch (error) {
    return errorResponse(error)
  }
}
