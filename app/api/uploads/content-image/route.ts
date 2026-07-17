import { NextResponse } from 'next/server'
import { publicImageUrl, supabasePublicObjectUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const guard = await requireUser(); if (!guard.user) return guard.response
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'eason-fans-club'
  if (!supabaseUrl || !key) return NextResponse.json({ message: '图片存储尚未配置' }, { status: 503 })
  const form = await request.formData().catch(() => null); const file = form?.get('file')
  if (!(file instanceof File) || file.type !== 'image/webp') return NextResponse.json({ message: '仅接受压缩后的 WebP 图片' }, { status: 400 })
  if (file.size > 5 * 1024 * 1024) return NextResponse.json({ message: '图片压缩后不能超过 5MB' }, { status: 400 })
  const path = `content/${guard.user.id}/${crypto.randomUUID()}.webp`
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'image/webp', 'Cache-Control': '31536000', 'x-upsert': 'false' }, body: await file.arrayBuffer() })
  if (!response.ok) return NextResponse.json({ message: '图片上传失败' }, { status: 502 })
  const url = publicImageUrl(supabasePublicObjectUrl(supabaseUrl, bucket, path))
  return url ? NextResponse.json({ url, mimeType: 'image/webp' }) : NextResponse.json({ message: '图片地址无效' }, { status: 500 })
}
