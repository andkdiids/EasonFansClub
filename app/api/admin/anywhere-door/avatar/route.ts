import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp, { type Metadata } from 'sharp'
import { ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import {
  ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_KEY,
  ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_LABEL,
  getAnywhereDoorAvatarProfile,
  safePublicAnywhereDoorAvatarUrl,
} from '@/lib/anywhere-door/avatar'
import { publicImageUrl } from '@/lib/images'
import { createImageVariants, ImageNormalizeError } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'

export const runtime = 'nodejs'

const MAX_AVATAR_FILE_SIZE = 5 * 1024 * 1024
const ALLOWED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  return 'image/webp'
}

async function readAutoAvatarUrl() {
  try {
    const latest = await prisma.socialPost.findFirst({
      where: {
        platform: 'INSTAGRAM',
        authorUsername: ANYWHERE_DOOR_TARGET,
        status: 'READY',
        authorAvatarUrl: { not: null },
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      select: { authorAvatarUrl: true },
    })
    return safePublicAnywhereDoorAvatarUrl(latest?.authorAvatarUrl)
  } catch {
    // The optional avatar column was introduced after the first sync schema;
    // the account settings screen must stay usable while it is being applied.
    return null
  }
}

async function avatarProfile() {
  return getAnywhereDoorAvatarProfile({ autoAvatarUrl: await readAutoAvatarUrl() })
}

async function guardAvatarRequest(request: Request, method: string) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return { user: null, response: originError }
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: `/api/admin/anywhere-door/avatar:${method}`,
    ip: { limit: 20, windowSeconds: 60 * 60 },
    user: { limit: 10, windowSeconds: 60 * 60 },
  }, '头像操作过于频繁，请稍后再试')
  if (limited) return { user: null, response: limited }
  return guard
}

export async function GET() {
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  try {
    return NextResponse.json({ avatar: await avatarProfile() }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.anywhere-door.avatar.read]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '账号头像状态暂时无法加载' }, { status: 503 })
  }
}

export async function POST(request: Request) {
  const guard = await guardAvatarRequest(request, 'POST')
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择要上传的头像图片' }, { status: 400 })
  if (!ALLOWED_AVATAR_TYPES.has(file.type.trim().toLowerCase())) return NextResponse.json({ message: '仅支持 JPG、PNG 或 WebP 图片' }, { status: 400 })
  if (file.size < 1) return NextResponse.json({ message: '图片内容为空' }, { status: 400 })
  if (file.size > MAX_AVATAR_FILE_SIZE) return NextResponse.json({ message: '头像不能超过 5MB' }, { status: 400 })

  let input: Buffer
  let metadata: Metadata
  let generated: Awaited<ReturnType<typeof createImageVariants>>
  try {
    input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { failOn: 'none', limitInputPixels: 50_000_000 })
    metadata = await image.metadata()
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
      return NextResponse.json({ message: '图片内容格式无效，仅支持 JPG、PNG 或 WebP' }, { status: 400 })
    }
    generated = await createImageVariants(input, {
      sourceMaxWidth: 512,
      sourceMaxHeight: 512,
      sourceQuality: 84,
      variants: ['avatar-sm', 'avatar-md'],
    })
  } catch (error) {
    if (!(error instanceof ImageNormalizeError)) console.error('[admin.anywhere-door.avatar.normalize]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '头像处理失败，请换一张图片重试' }, { status: 400 })
  }

  const hash = createHash('sha256').update(input).digest('hex')
  const sourceObjectPath = `social/instagram/${ANYWHERE_DOOR_TARGET}/avatar/${hash}/source.webp`
  let uploadedUrl: string | null = null
  try {
    const result = await uploadImageVariantFamily({
      sourceObjectPath,
      original: input,
      originalContentType: imageContentType(metadata.format),
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    })
    uploadedUrl = publicImageUrl(result.sourceUrl)
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) console.error('[admin.anywhere-door.avatar.upload]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '头像上传失败，请稍后重试' }, { status: 502 })
  }

  const safeUrl = safePublicAnywhereDoorAvatarUrl(uploadedUrl)
  if (!safeUrl) return NextResponse.json({ message: '头像上传结果无效，请重试' }, { status: 502 })

  try {
    await prisma.siteSetting.upsert({
      where: { key: ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_KEY },
      update: { value: safeUrl, valueType: 'TEXT', group: 'social', label: ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_LABEL },
      create: { key: ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_KEY, value: safeUrl, valueType: 'TEXT', group: 'social', label: ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_LABEL },
    })
  } catch (error) {
    console.error('[admin.anywhere-door.avatar.save]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '头像已上传，但设置保存失败，请稍后重试' }, { status: 503 })
  }

  return NextResponse.json({ avatar: await avatarProfile() }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function DELETE(request: Request) {
  const guard = await guardAvatarRequest(request, 'DELETE')
  if (!guard.user) return guard.response
  try {
    await prisma.siteSetting.deleteMany({ where: { key: ANYWHERE_DOOR_MANUAL_AVATAR_SETTING_KEY } })
    return NextResponse.json({ avatar: await avatarProfile() }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.anywhere-door.avatar.reset]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '恢复自动头像失败，请稍后重试' }, { status: 503 })
  }
}
