import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { parseConcertCategory, parseLiveDate, parseLiveInteger, parsePublicationStatus } from '@/lib/music-live'
import { CONCERT_CATEGORY_ENUM_TO_SLUG, slugToConcertCategoryEnum } from '@/lib/music-concert-category'
import { toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

type Context = { params: Promise<{ tourId: string }> }

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { tourId } = await params
  const tour = await prisma.musicTour.findUnique({ where: { id: tourId }, include: { _count: { select: { MusicConcert: true } } } })
  if (!tour) return NextResponse.json({ message: '巡演不存在' }, { status: 404 })
  return NextResponse.json({ tour: { ...tour, posterUrl: toPublicMediaUrl(tour.posterUrl), concertCount: tour._count.MusicConcert, _count: undefined } })
}

// 解析分类：优先使用动态选中的 categoryId（关联 MusicConcertCategory），否则回退到旧枚举 category。
async function resolveTourCategory(body: Record<string, unknown> | null): Promise<{ category: 'MAIN' | 'SMALL' | 'GUEST'; categoryId: string | null } | { error: string }> {
  const categoryId = typeof body?.categoryId === 'string' ? body.categoryId.trim() : ''
  if (categoryId) {
    const cat = await prisma.musicConcertCategory.findUnique({ where: { id: categoryId }, select: { id: true, slug: true } })
    if (!cat) return { error: '演唱会分类无效' }
    return { category: slugToConcertCategoryEnum(cat.slug), categoryId: cat.id }
  }
  const legacy = parseConcertCategory(body?.category)
  if (!legacy) return { error: '演唱会分类无效' }
  const reserved = await prisma.musicConcertCategory.findUnique({ where: { slug: CONCERT_CATEGORY_ENUM_TO_SLUG[legacy] }, select: { id: true } }).catch(() => null)
  return { category: legacy, categoryId: reserved?.id ?? null }
}

export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { tourId } = await params
  const body = await request.json().catch(() => null)
  const name = sanitizeText(body?.name, 160)
  const startDate = parseLiveDate(body?.startDate)
  const endDate = parseLiveDate(body?.endDate)
  const sortOrder = parseLiveInteger(body?.sortOrder)
  const hasCoverUrl = Boolean(body && typeof body === 'object' && ('coverUrl' in body || 'posterUrl' in body))
  const posterUrl = sanitizeText(body?.coverUrl ?? body?.posterUrl, 1000) || null
  if (!name) return NextResponse.json({ message: '请填写巡演名称' }, { status: 400 })
  if (startDate === undefined || endDate === undefined || (startDate && endDate && startDate > endDate)) return NextResponse.json({ message: '巡演日期无效' }, { status: 400 })
  if (sortOrder === undefined) return NextResponse.json({ message: '排序必须是非负整数' }, { status: 400 })
  const resolved = await resolveTourCategory(body)
  if ('error' in resolved) return NextResponse.json({ message: resolved.error }, { status: 400 })
  try {
    const tour = await prisma.musicTour.update({
      where: { id: tourId },
      data: {
        name,
        subtitle: sanitizeText(body?.subtitle, 200) || null,
        description: sanitizeText(body?.description, 20_000) || null,
        ...(hasCoverUrl ? { posterUrl } : {}),
        startDate,
        endDate,
        category: resolved.category,
        categoryId: resolved.categoryId,
        sortOrder,
       status: parsePublicationStatus(body?.status),
     },
   })
    tour.posterUrl = toPublicMediaUrl(tour.posterUrl)
    return NextResponse.json({ tour, message: tour.status === 'PUBLISHED' ? '巡演已发布' : '巡演草稿已保存' })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') return NextResponse.json({ message: '巡演不存在' }, { status: 404 })
    throw error
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { tourId } = await params
  const tour = await prisma.musicTour.findUnique({ where: { id: tourId }, include: { _count: { select: { MusicConcert: true } } } })
  if (!tour) return NextResponse.json({ message: '巡演不存在' }, { status: 404 })
  if (tour._count.MusicConcert > 0) return NextResponse.json({ message: `该巡演已有 ${tour._count.MusicConcert} 个场次，请先处理关联场次后再删除` }, { status: 409 })
  await prisma.musicTour.delete({ where: { id: tourId } })
  return NextResponse.json({ ok: true, message: '巡演已删除' })
}
