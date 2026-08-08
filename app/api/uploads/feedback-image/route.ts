import { NextResponse } from 'next/server'
import { publicImageUrl, supabasePublicObjectUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'
import { FEEDBACK_ALLOWED_IMAGE_TYPES, FEEDBACK_MAX_FILE_SIZE } from '@/lib/feedback'
import { normalizeImageToWebp, ImageNormalizeError } from '@/lib/image-webp'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'eason-fans-club'

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ message: '图片存储尚未配置' }, { status: 500 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })
  }

  if (!FEEDBACK_ALLOWED_IMAGE_TYPES.includes(file.type as typeof FEEDBACK_ALLOWED_IMAGE_TYPES[number])) {
    return NextResponse.json({ message: '不支持的图片格式' }, { status: 400 })
  }
  if (file.size > FEEDBACK_MAX_FILE_SIZE) {
    return NextResponse.json({ message: '单张图片不能超过 10MB' }, { status: 400 })
  }

  // 统一在服务端转 WebP + 压缩，禁止原样存储 jpg/png/gif。
  let webpBuffer: Buffer
  try {
    webpBuffer = await normalizeImageToWebp(
      Buffer.from(await file.arrayBuffer()),
      { maxWidth: 1600, quality: 82 },
    )
  } catch (error) {
    if (error instanceof ImageNormalizeError) {
      return NextResponse.json({ message: error.message }, { status: 400 })
    }
    return NextResponse.json({ message: '图片处理失败，请换一张试试' }, { status: 400 })
  }

  const objectPath = `feedback/${guard.user.id}/feedback-${crypto.randomUUID()}.webp`
  const storageResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Cache-Control': '31536000',
      'Content-Type': 'image/webp',
      'x-upsert': 'false',
    },
    body: new Uint8Array(webpBuffer),
  })

  if (!storageResponse.ok) {
    const errorText = await storageResponse.text().catch(() => '')
    return NextResponse.json({ message: '图片上传失败', detail: errorText.slice(0, 200) }, { status: 502 })
  }

  const url = publicImageUrl(supabasePublicObjectUrl(supabaseUrl, bucket, objectPath))
  if (!url) {
    return NextResponse.json({ message: '图片 URL 无效' }, { status: 500 })
  }

  return NextResponse.json({ url, mimeType: 'image/webp' })
}
