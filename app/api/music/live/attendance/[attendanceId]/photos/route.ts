import { NextResponse } from 'next/server'
import {
  assertOwnMyLiveAttendance,
  getMyLiveWatermarkIdentity,
  getOwnMyLivePhotos,
  MY_LIVE_PHOTO_LIMITS,
  MY_LIVE_PHOTO_MAX_FILE_SIZE,
  MY_LIVE_PHOTO_MAX_REQUEST_SIZE,
  MyLivePhotoRequestError,
  parseMyLivePhotoCategory,
  parseMyLivePhotoWatermark,
  processMyLivePhoto,
  uploadMyLivePhotos,
} from '@/lib/my-live-photos'
import { PERSONAL_LIVE_NO_STORE_HEADERS, withPersonalNoStore } from '@/lib/music-personal-live'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ attendanceId: string }> }

function isMultipartFile(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value
      && typeof value !== 'string'
      && typeof value.size === 'number'
      && typeof value.arrayBuffer === 'function',
  )
}

function errorResponse(error: unknown) {
  if (error instanceof MyLivePhotoRequestError) {
    return NextResponse.json({ message: error.message }, { status: error.status, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }
  console.error('[music.live.photos]', error instanceof Error ? error.message : error)
  return NextResponse.json({ message: '照片上传失败，请稍后重试' }, { status: 500, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
}

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const { attendanceId } = await params
  try {
    const photos = await getOwnMyLivePhotos(guard.user.id, attendanceId)
    return NextResponse.json({ attendanceId, photos }, { headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request, { params }: Context) {
  const guard = await requireUser()
  if (!guard.user) return withPersonalNoStore(guard.response)
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return withPersonalNoStore(originError)
  const { attendanceId } = await params
  const contentLengthHeader = request.headers.get('content-length')
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN
  if (Number.isFinite(contentLength) && contentLength > MY_LIVE_PHOTO_MAX_REQUEST_SIZE) {
    return NextResponse.json({ message: '本次上传内容过大，请减少照片数量或压缩后重试' }, { status: 413, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ message: '图片上传请求无效，请重新选择图片' }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }

  const category = parseMyLivePhotoCategory(form.get('category'))
  if (!category) return NextResponse.json({ message: '照片分类无效' }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  const watermark = parseMyLivePhotoWatermark(form.get('watermark'))
  if (watermark === undefined) return NextResponse.json({ message: '水印选项无效' }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })

  const entries = form.getAll('files')
  const files = entries.filter(isMultipartFile)
  if (!files.length || files.length !== entries.length) {
    return NextResponse.json({ message: '未收到有效图片文件' }, { status: 400, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }
  const categoryLimit = MY_LIVE_PHOTO_LIMITS[category]
  if (files.length > categoryLimit) {
    return NextResponse.json({ message: `${category === 'TICKET' ? '票根' : '现场'}本批次最多选择${categoryLimit}张` }, { status: 409, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  }

  try {
    await assertOwnMyLiveAttendance(guard.user.id, attendanceId)
    const identity = watermark ? await getMyLiveWatermarkIdentity(guard.user.id) : undefined
    const processed = []
    for (const file of files) {
      if (file.size < 1) throw new MyLivePhotoRequestError(400, '图片内容为空')
      if (file.size > MY_LIVE_PHOTO_MAX_FILE_SIZE) throw new MyLivePhotoRequestError(400, '图片不能超过 12MB')
      let buffer: Buffer
      try {
        buffer = Buffer.from(await file.arrayBuffer())
      } catch {
        throw new MyLivePhotoRequestError(400, '读取图片失败，请重新选择图片')
      }
      processed.push(await processMyLivePhoto(buffer, file.type.trim().toLowerCase(), watermark, identity))
    }
    const photos = await uploadMyLivePhotos({ userId: guard.user.id, attendanceId, category, watermark, photos: processed })
    return NextResponse.json({ attendanceId, addedCount: processed.length, photos }, { status: 201, headers: PERSONAL_LIVE_NO_STORE_HEADERS })
  } catch (error) {
    return errorResponse(error)
  }
}
