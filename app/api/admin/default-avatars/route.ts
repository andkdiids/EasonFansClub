import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import {
  assignDefaultAvatarsToUnassignedUsers,
  getDefaultAvatarPool,
  saveDefaultAvatarPool,
} from '@/lib/default-avatars'
import { publicImageUrl, supabasePublicObjectUrl } from '@/lib/images'
import { requireAdmin } from '@/lib/security'

export const runtime = 'nodejs'

const MAX_FILE_SIZE = 8 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

async function guardAdmin() {
  return requireAdmin('site_config_manage')
}

export async function GET() {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response
  return NextResponse.json({ avatars: await getDefaultAvatarPool() })
}

export async function POST(request: Request) {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择默认头像图片' }, { status: 400 })
  if (!ALLOWED_TYPES.has(file.type)) return NextResponse.json({ message: '仅支持 JPG、PNG 或 WebP 图片' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ message: '图片不能超过 8MB' }, { status: 413 })

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'eason-fans-club'
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ message: 'Supabase Storage 尚未配置' }, { status: 500 })
  }

  let output: Buffer
  try {
    output = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none', limitInputPixels: 40_000_000 })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 1000, height: 1000, fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer()
  } catch (error) {
    console.error('[default-avatar] sharp conversion failed', error)
    return NextResponse.json({ message: '头像转换失败，请检查图片文件后重试' }, { status: 422 })
  }

  const objectPath = `site/default-avatars/${randomUUID()}.webp`
  const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Cache-Control': '31536000',
      'Content-Type': 'image/webp',
      'x-upsert': 'false',
    },
    body: output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer,
  })
  if (!response.ok) {
    console.error('[default-avatar] storage upload failed', await response.text().catch(() => ''))
    return NextResponse.json({ message: '默认头像上传失败，请稍后重试' }, { status: 502 })
  }

  const url = publicImageUrl(supabasePublicObjectUrl(supabaseUrl, bucket, objectPath))
  if (!url) return NextResponse.json({ message: '默认头像地址无效' }, { status: 500 })

  const avatars = await getDefaultAvatarPool(undefined, true)
  avatars.push({ id: randomUUID(), url, enabled: true, createdAt: new Date().toISOString() })
  await saveDefaultAvatarPool(avatars)
  const assignedCount = await assignDefaultAvatarsToUnassignedUsers()
  return NextResponse.json({ avatars: avatars.filter((item) => !item.retired), assignedCount, message: '默认头像已转换为 WebP 并启用' }, { status: 201 })
}

export async function PATCH(request: Request) {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  if (!id || typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ message: '默认头像状态参数无效' }, { status: 400 })
  }

  const avatars = await getDefaultAvatarPool(undefined, true)
  const index = avatars.findIndex((item) => item.id === id)
  if (index < 0) return NextResponse.json({ message: '默认头像不存在' }, { status: 404 })
  avatars[index] = { ...avatars[index], enabled: body.enabled }
  await saveDefaultAvatarPool(avatars)
  const assignedCount = body.enabled ? await assignDefaultAvatarsToUnassignedUsers() : 0
  return NextResponse.json({ avatars: avatars.filter((item) => !item.retired), assignedCount, message: body.enabled ? '默认头像已启用' : '默认头像已停用' })
}

export async function DELETE(request: Request) {
  const guard = await guardAdmin()
  if (!guard.user) return guard.response
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ message: '缺少默认头像 ID' }, { status: 400 })

  const avatars = await getDefaultAvatarPool(undefined, true)
  const index = avatars.findIndex((item) => item.id === id && !item.retired)
  if (index < 0) return NextResponse.json({ message: '默认头像不存在' }, { status: 404 })
  avatars[index] = { ...avatars[index], enabled: false, retired: true }
  await saveDefaultAvatarPool(avatars)

  // 已分配头像继续引用原文件，因此这里只移出头像池，不删除存储对象。
  return NextResponse.json({ avatars: avatars.filter((item) => !item.retired), message: '默认头像已从分配池移除，已有用户头像保持不变' })
}
