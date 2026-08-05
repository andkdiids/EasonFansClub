import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { publicImageUrl } from '@/lib/images'
import { requireUser } from '@/lib/security'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'

export const runtime = 'nodejs'

const maxFileSize = 10 * 1024 * 1024
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const formData = await request.formData().catch(() => null)
  const file = formData?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '璇烽€夋嫨瑕佷笂浼犵殑鍥剧墖' }, { status: 400 })
  if (!allowedTypes.has(file.type)) return NextResponse.json({ message: '浠呮敮鎸?JPG銆丳NG銆乄ebP 鎴?GIF 鍥剧墖' }, { status: 400 })
  if (file.size > maxFileSize) return NextResponse.json({ message: '鍥剧墖涓嶈兘瓒呰繃 10MB' }, { status: 400 })

  try {
    const output = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: 'none', limitInputPixels: 30_000_000 })
      .rotate()
      .resize({ width: 2000, height: 1400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer()
    const url = publicImageUrl(await uploadSiteImage({ key: `today/${guard.user.id}/${randomUUID()}.webp`, body: output }))
    return NextResponse.json({ url, mimeType: 'image/webp', format: 'webp' })
  } catch (error) {
    if (!(error instanceof SiteMediaStorageError)) console.error('[today-image.upload]', error)
    return NextResponse.json({ message: error instanceof Error ? error.message : '鍥剧墖涓婁紶澶辫触' }, { status: 502 })
  }
}
