import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { createImageVariants } from '@/lib/image-webp'
import { uploadImageVariantFamily } from '@/lib/image-variant-upload'
import { publicImageUrl } from '@/lib/images'
import { getSalonPosts, parseSalonCategory, parseSalonFilters } from '@/lib/salon'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireUser, sanitizeText } from '@/lib/security'
import { SiteMediaStorageError, uploadSiteImage } from '@/lib/site-media-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FILES = 9
const MAX_FILE_SIZE = 20 * 1024 * 1024
const MAX_TOTAL_SIZE = MAX_FILES * MAX_FILE_SIZE
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp'])
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/pjpeg'])
const FORMAT_BY_EXTENSION: Record<string, string> = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' }
const MIME_BY_FORMAT: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

function isMultipartFile(value: FormDataEntryValue | null): value is File {
  return Boolean(value && typeof value !== 'string' && typeof value.size === 'number' && typeof value.arrayBuffer === 'function')
}

function uploadError(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status })
}

async function inspectImage(file: File, index: number) {
  const extension = file.name.split('.').pop()?.trim().toLowerCase() || ''
  if (!ALLOWED_EXTENSIONS.has(extension)) throw new Error(`第 ${index + 1} 张图片格式不支持，仅支持 JPG、PNG、WEBP`)
  if (file.type && !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())) throw new Error(`第 ${index + 1} 张图片的 MIME 类型无效`)
  if (file.size <= 0 || file.size > MAX_FILE_SIZE) throw new Error(`第 ${index + 1} 张图片不能超过 20MB`)

  const buffer = Buffer.from(await file.arrayBuffer())
  const image = sharp(buffer, { failOn: 'error', limitInputPixels: 100_000_000 })
  const metadata = await image.metadata()
  const format = metadata.format || ''
  if (!MIME_BY_FORMAT[format] || FORMAT_BY_EXTENSION[extension] !== format) throw new Error(`第 ${index + 1} 张图片文件头与扩展名不匹配`)
  if (file.type && file.type.toLowerCase() !== MIME_BY_FORMAT[format] && !(file.type.toLowerCase() === 'image/pjpeg' && format === 'jpeg')) throw new Error(`第 ${index + 1} 张图片的 MIME 类型与文件内容不匹配`)
  if (!metadata.width || !metadata.height) throw new Error(`第 ${index + 1} 张图片尺寸无效`)
  if (metadata.pages && metadata.pages > 1) throw new Error(`第 ${index + 1} 张图片不能是动态图片`)

  const orientation = metadata.orientation || 1
  const rotated = orientation >= 5 && orientation <= 8
  return {
    buffer,
    width: rotated ? metadata.height : metadata.width,
    height: rotated ? metadata.width : metadata.height,
    contentType: MIME_BY_FORMAT[format],
  }
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const filters = parseSalonFilters({
    category: params.get('category') || undefined,
    concert: params.get('concert') || undefined,
    session: params.get('session') || undefined,
    sort: params.get('sort') || undefined,
    cursor: params.get('cursor') || undefined,
  })
  const user = await requireUser().then((result) => result.user).catch(() => null)
  const data = await getSalonPosts(filters, user?.id)
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/salon/posts',
    ip: { limit: 15, windowSeconds: 60 * 60 },
    user: { limit: 5, windowSeconds: 60 * 60 },
  }, '投稿过于频繁，请稍后再试')
  if (limited) return limited

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return uploadError('投稿请求无效，请重新提交')
  }

  const category = parseSalonCategory(form.get('category'))
  const concertId = sanitizeText(form.get('concertId'), 191)
  const title = sanitizeText(form.get('title'), 200) || null
  const content = sanitizeText(form.get('content'), 5000) || null
  const submissionKey = sanitizeText(form.get('submissionKey'), 64) || null
  if (!category) return uploadError('请选择投稿分类')
  if (!concertId) return uploadError('请选择对应的演唱会和场次')

  const concert = await prisma.musicConcert.findFirst({
    where: { id: concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } },
    select: { id: true },
  })
  if (!concert) return uploadError('演唱会场次不存在或暂未公开')

  if (submissionKey) {
    const existing = await prisma.salonPost.findFirst({ where: { userId: guard.user.id, submissionKey }, select: { id: true } })
    if (existing) return NextResponse.json({ ok: true, duplicate: true, postId: existing.id, message: '这次投稿已经提交过了' })
  }

  const files = form.getAll('file').filter(isMultipartFile)
  if (!files.length) return uploadError('请至少选择一张图片')
  if (files.length > MAX_FILES) return uploadError(`一次最多上传 ${MAX_FILES} 张图片`)
  if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_SIZE) return uploadError('本次图片总大小过大，请分批投稿')

  const inspected: Array<Awaited<ReturnType<typeof inspectImage>>> = []
  try {
    for (const [index, file] of files.entries()) inspected.push(await inspectImage(file, index))
  } catch (error) {
    return uploadError(error instanceof Error ? error.message : '图片校验失败')
  }

  const postId = randomUUID()
  try {
    const media = []
    for (const [index, image] of inspected.entries()) {
      const sourceObjectPath = `salon/${guard.user.id}/${postId}/${index + 1}-${randomUUID()}/source.webp`
      const generated = await createImageVariants(image.buffer, {
        sourceMaxWidth: 2560,
        sourceQuality: 90,
        variants: ['thumb-md', 'card', 'large'],
      })
      const uploaded = await uploadImageVariantFamily({
        sourceObjectPath,
        original: image.buffer,
        originalContentType: image.contentType,
        generated,
        upload: ({ key, body, contentType }) => uploadSiteImage({ key, body, contentType }),
      })
      const thumbnailUrl = uploaded.variantUrls['thumb-md'] || uploaded.sourceUrl
      const previewUrl = uploaded.variantUrls.large || uploaded.variantUrls.card || uploaded.sourceUrl
      media.push({
        originalUrl: publicImageUrl(uploaded.originalUrl) || uploaded.originalUrl,
        previewUrl: publicImageUrl(previewUrl) || previewUrl,
        thumbnailUrl: publicImageUrl(thumbnailUrl) || thumbnailUrl,
        storageKey: sourceObjectPath,
        width: image.width,
        height: image.height,
        sortOrder: index,
      })
    }

    const post = await prisma.salonPost.create({
      data: {
        id: postId,
        userId: guard.user.id,
        category,
        concertId: concert.id,
        title,
        content,
        submissionKey,
        media: { create: media },
      },
      select: { id: true },
    })
    return NextResponse.json({ ok: true, postId: post.id, message: '投稿成功，作品将在审核通过后公开显示。' }, { status: 201 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && submissionKey) {
      const existing = await prisma.salonPost.findFirst({ where: { userId: guard.user.id, submissionKey }, select: { id: true } })
      if (existing) return NextResponse.json({ ok: true, duplicate: true, postId: existing.id, message: '这次投稿已经提交过了' })
    }
    if (error instanceof SiteMediaStorageError) return NextResponse.json({ ok: false, message: error.message }, { status: 502 })
    console.error('[salon.posts.create]', { userId: guard.user.id, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ ok: false, message: '投稿失败，请稍后重试' }, { status: 500 })
  }
}
