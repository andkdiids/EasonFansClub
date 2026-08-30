import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { supportsOriginal } from '@/lib/salon'
import { getCosObject } from '@/lib/tencent-cos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ mediaId: string }> }

const mediaIdPattern = /^[a-zA-Z0-9_-]{1,191}$/
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function safeFilename(value: string | null | undefined, postId: string, sortOrder: number, mimeType: string | null) {
  const cleaned = value?.normalize('NFKC').replace(/[\\/\u0000-\u001f\u007f"']/g, '_').trim().slice(0, 160)
  if (cleaned) return cleaned
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg'
  return `ECFC-Salon-${postId}-${sortOrder + 1}.${extension}`
}

function safeOriginalObjectKey(postId: string, storedKey: string | null) {
  const storedCandidate = storedKey?.trim().replace(/^\/+/, '') || null
  const candidate = storedCandidate || ''
  const segments = candidate.split('/')
  if (segments.length !== 5 || segments[0] !== 'salon' || segments[2] !== postId || segments[4] !== 'original') return null
  if (segments.some((segment) => !/^[a-zA-Z0-9_-]+$/u.test(segment))) return null
  return candidate
}

export async function GET(request: Request, context: RouteContext) {
  const { mediaId } = await context.params
  if (!mediaIdPattern.test(mediaId)) return NextResponse.json({ message: '图片标识无效' }, { status: 400 })

  const media = await prisma.salonPostMedia.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      postId: true,
      originalObjectKey: true,
      originalFilename: true,
      originalMimeType: true,
      originalSize: true,
      sortOrder: true,
      post: {
        select: {
          id: true,
          userId: true,
          category: true,
          status: true,
          approvedAt: true,
          concert: { select: { status: true, MusicTour: { select: { status: true } } } },
        },
      },
    },
  })
  if (!media) return NextResponse.json({ message: '原图不存在' }, { status: 404 })
  if (!supportsOriginal(media.post.category)) return NextResponse.json({ message: '该分类不提供原图' }, { status: 404 })

  const user = await getCurrentUser()
  const isOwner = user?.id === media.post.userId
  const canModerate = Boolean(user && await hasAdminPermission(user, 'post_manage').catch(() => false))
  const isPublic = media.post.status === 'APPROVED'
    && Boolean(media.post.approvedAt)
    && (media.post.category !== 'CONCERT'
      || Boolean(media.post.concert && media.post.concert.status === 'PUBLISHED' && media.post.concert.MusicTour.status === 'PUBLISHED'))
  if (!isPublic && !isOwner && !canModerate) return NextResponse.json({ message: '原图暂不可访问' }, { status: 404 })

  const objectKey = safeOriginalObjectKey(media.post.id, media.originalObjectKey)
  if (!objectKey) return NextResponse.json({ message: '该作品暂无原图' }, { status: 404 })

  let body: Buffer
  try {
    body = await getCosObject(objectKey)
  } catch (error) {
    console.error('[salon.media.original]', { mediaId, objectKey, errorName: error instanceof Error ? error.name : 'unknown' })
    return NextResponse.json({ message: '原图暂时无法下载，请稍后重试' }, { status: 502 })
  }

  const filename = safeFilename(media.originalFilename, media.post.id, media.sortOrder, media.originalMimeType)
  const asciiFilename = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || `ECFC-Salon-${media.post.id}-${media.sortOrder + 1}.jpg`
  const mimeType = media.originalMimeType && MIME_TYPES.has(media.originalMimeType) ? media.originalMimeType : 'application/octet-stream'
  const mode = new URL(request.url).searchParams.get('mode') === 'view' ? 'view' : 'download'
  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `${mode === 'view' ? 'inline' : 'attachment'}; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
