import { NextResponse } from 'next/server'
import { publicImageUrl, supabasePublicObjectUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'

export const runtime = 'nodejs'

const maxFileSize = 8 * 1024 * 1024
const allowedTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

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

  const extension = allowedTypes.get(file.type)
  if (!extension) {
    return NextResponse.json({ message: '仅支持 JPG、PNG、WEBP 或 GIF 图片' }, { status: 400 })
  }

  if (file.size > maxFileSize) {
    return NextResponse.json({ message: '单张图片不能超过 8MB' }, { status: 400 })
  }

  const objectPath = `feedback/${guard.user.id}/feedback-${crypto.randomUUID()}.${extension}`
  const storageResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Cache-Control': '31536000',
      'Content-Type': file.type,
      'x-upsert': 'false',
    },
    body: await file.arrayBuffer(),
  })

  if (!storageResponse.ok) {
    const errorText = await storageResponse.text().catch(() => '')
    return NextResponse.json({ message: '图片上传失败', detail: errorText.slice(0, 200) }, { status: 502 })
  }

  const url = publicImageUrl(supabasePublicObjectUrl(supabaseUrl, bucket, objectPath))
  if (!url) {
    return NextResponse.json({ message: '图片 URL 无效' }, { status: 500 })
  }

  return NextResponse.json({ url, mimeType: file.type })
}
