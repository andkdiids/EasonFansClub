import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'
import { createAnimatedImageVariants, createImageVariants, isAnimatedImageInput } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'

export const runtime = 'nodejs'

const maxFileSize = 10 * 1024 * 1024
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

function imageContentType(format?: string | null) {
  if (format === 'jpeg') return 'image/jpeg'
  if (format === 'png') return 'image/png'
  if (format === 'gif') return 'image/gif'
  return 'image/webp'
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '璇烽€夋嫨瑕佷笂浼犵殑鍥剧墖' }, { status: 400 })
  if (!allowedTypes.has(file.type)) return NextResponse.json({ message: '浠呮敮鎸?JPG銆丳NG銆乄ebP 鎴?GIF 鍥剧墖' }, { status: 400 })
  if (file.size > maxFileSize) return NextResponse.json({ message: '鍥剧墖涓嶈兘瓒呰繃 10MB' }, { status: 400 })

  try {
    const input = Buffer.from(await file.arrayBuffer())
    const image = sharp(input, { animated: true, failOn: 'none', limitInputPixels: 30_000_000 })
    const metadata = await image.metadata()
    const animated = isAnimatedImageInput(input, metadata)
    const generated = animated
      ? await createAnimatedImageVariants(input, { sourceMaxWidth: 2000, variants: ['thumb-md', 'card', 'large'] })
      : await createImageVariants(input, { sourceMaxWidth: 2000, sourceMaxHeight: 1400, sourceQuality: 84, variants: ['thumb-md', 'card', 'large'] })
    const uploadResult = await uploadImageVariantFamily({
      sourceObjectPath: `today/${guard.user.id}/${randomUUID()}/source.webp`,
      original: input,
      originalContentType: imageContentType(metadata.format),
      generated,
      upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
    })
    const url = publicImageUrl(uploadResult.sourceUrl)
    return NextResponse.json({ url, mimeType: 'image/webp', format: 'webp' })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) console.error('[today-image.upload]', error)
    return NextResponse.json({ message: error instanceof Error ? error.message : '鍥剧墖涓婁紶澶辫触' }, { status: 502 })
  }
}
