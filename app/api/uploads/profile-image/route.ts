import { NextResponse } from 'next/server'
import { publicImageUrl, supabasePublicObjectUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'
import { invalidateCurrentUserCache } from '@/lib/auth'

export const runtime = 'nodejs'

const avatarMaxFileSize = 10 * 1024 * 1024
const backgroundMaxFileSize = 8 * 1024 * 1024
const avatarTypes = new Map([
  ['image/webp', 'webp'],
  ['image/jpeg', 'jpg'],
])
const backgroundTypes = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

function createCompatibleId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function storagePathFromPublicUrl(url?: string | null) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'eason-fans-club'
  if (!url || !supabaseUrl) return null

  const cleanUrl = url.split('?')[0]
  const marker = `/storage/v1/object/public/${encodeURIComponent(bucket)}/`
  if (!cleanUrl.startsWith(supabaseUrl) || !cleanUrl.includes(marker)) return null
  return decodeURIComponent(cleanUrl.slice(cleanUrl.indexOf(marker) + marker.length))
}

async function removeStorageObject(path: string | null) {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'eason-fans-club'
  if (!path || !supabaseUrl || !serviceRoleKey) return

  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/remove`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [path] }),
    })
    if (!response.ok) {
      console.warn('[profile-image] old avatar cleanup failed', await response.text().catch(() => ''))
    }
  } catch (error) {
    console.warn('[profile-image] old avatar cleanup failed', error)
  }
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'eason-fans-club'

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ message: 'Supabase Storage 尚未配置' }, { status: 500 })
  }

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  const kind = String(formData?.get('kind') || 'avatar') === 'background' ? 'background' : 'avatar'

  if (!(file instanceof File)) {
    return NextResponse.json({ message: '请选择要上传的图片' }, { status: 400 })
  }

  if (kind === 'avatar') {
    if (!avatarTypes.has(file.type)) {
      return NextResponse.json({ message: '头像必须先裁剪为 WebP 或 JPEG 后上传' }, { status: 400 })
    }
    if (file.size > avatarMaxFileSize) {
      return NextResponse.json({ message: '头像文件不能超过 10MB' }, { status: 400 })
    }
  } else {
    if (!backgroundTypes.has(file.type)) {
      return NextResponse.json({ message: '背景图仅支持 JPG、PNG、WEBP 或 GIF' }, { status: 400 })
    }
    if (file.size > backgroundMaxFileSize) {
      return NextResponse.json({ message: '背景图不能超过 8MB' }, { status: 400 })
    }
  }

  const extension = kind === 'avatar' ? avatarTypes.get(file.type) : backgroundTypes.get(file.type)
  const objectPath =
    kind === 'avatar'
      ? `avatars/${guard.user.id}/${createCompatibleId()}.${extension}`
      : `profiles/${guard.user.id}/background-${createCompatibleId()}.${extension}`

  let storageResponse: Response
  try {
    storageResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${bucket}/${objectPath}`, {
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
  } catch (error) {
    console.error('[profile-image] storage upload failed', {
      userId: guard.user.id,
      kind,
      fileSize: file.size,
      fileType: file.type,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return NextResponse.json({ message: kind === 'avatar' ? '头像上传失败，请稍后再试' : '背景图上传失败，请稍后再试' }, { status: 502 })
  }

  if (!storageResponse.ok) {
    const errorText = await storageResponse.text().catch(() => '')
    return NextResponse.json({ message: 'Supabase Storage 上传失败', detail: errorText.slice(0, 200) }, { status: 502 })
  }

  const safeUrl = publicImageUrl(supabasePublicObjectUrl(supabaseUrl, bucket, objectPath))
  if (!safeUrl) {
    return NextResponse.json({ message: '图片 URL 无效' }, { status: 500 })
  }

  const current = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: {
      avatarUrl: true,
      backgroundUrl: true,
      profile: { select: { avatarUrl: true, backgroundUrl: true } },
    },
  })

  try {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: guard.user.id },
        data: kind === 'avatar' ? { avatarUrl: safeUrl } : { backgroundUrl: safeUrl },
      }),
      prisma.profile.upsert({
        where: { userId: guard.user.id },
        update: kind === 'avatar' ? { avatarUrl: safeUrl } : { backgroundUrl: safeUrl },
        create: {
          userId: guard.user.id,
          displayName: guard.user.nickname,
          avatarUrl: kind === 'avatar' ? safeUrl : null,
          backgroundUrl: kind === 'background' ? safeUrl : null,
        },
      }),
    ])
  } catch (error) {
    console.error('[profile-image] profile update failed', {
      userId: guard.user.id,
      kind,
      fileSize: file.size,
      fileType: file.type,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    void removeStorageObject(objectPath)
    return NextResponse.json({ message: kind === 'avatar' ? '头像已上传，但资料更新失败，请稍后再试' : '背景图已上传，但资料更新失败，请稍后再试' }, { status: 500 })
  }

  invalidateCurrentUserCache(guard.user.id)

  if (kind === 'avatar') {
    const oldPath = storagePathFromPublicUrl(current?.profile?.avatarUrl || current?.avatarUrl)
    const newPath = storagePathFromPublicUrl(safeUrl)
    if (oldPath && oldPath !== newPath) {
      void removeStorageObject(oldPath)
    }
  }

  return NextResponse.json({ url: safeUrl })
}
