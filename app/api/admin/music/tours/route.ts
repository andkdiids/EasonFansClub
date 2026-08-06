import { NextResponse } from 'next/server'
import { parseConcertCategory, parseLiveDate, parseLiveInteger, parsePublicationStatus } from '@/lib/music-live'
import { CONCERT_CATEGORY_ENUM_TO_SLUG, slugToConcertCategoryEnum } from '@/lib/music-concert-category'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const tours = await prisma.musicTour.findMany({
    orderBy: [{ sortOrder: 'asc' }, { startDate: 'desc' }, { createdAt: 'asc' }],
    include: { _count: { select: { MusicConcert: true } } },
  })
  return NextResponse.json({ tours: tours.map(({ _count, ...tour }) => ({ ...tour, concertCount: _count.MusicConcert })) })
}

// 解析分类：优先使用动态选中的 categoryId（关联 MusicConcertCategory），否则回退到旧枚举 category。
async function resolveTourCategory(body: Record<string, unknown> | null): Promise<{ category: 'MAIN' | 'SMALL' | 'GUEST'; categoryId: string | null } | { error: string }> {
  const categoryId = typeof body?.categoryId === 'string' ? body.categoryId.trim() : ''
  if (categoryId) {
    const cat = await prisma.musicConcertCategory.findUnique({ where: { id: categoryId }, select: { id: true, slug: true } })
    if (!cat) return { error: '演唱会分类无效' }
    return { category: slugToConcertCategoryEnum(cat.slug), categoryId: cat.id }
  }
  const legacy = parseConcertCategory(body?.category, 'MAIN')
  if (!legacy) return { error: '演唱会分类无效' }
  const reserved = await prisma.musicConcertCategory.findUnique({ where: { slug: CONCERT_CATEGORY_ENUM_TO_SLUG[legacy] }, select: { id: true } }).catch(() => null)
  return { category: legacy, categoryId: reserved?.id ?? null }
}

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const name = sanitizeText(body?.name, 160)
  const startDate = parseLiveDate(body?.startDate)
  const endDate = parseLiveDate(body?.endDate)
  const sortOrder = parseLiveInteger(body?.sortOrder)
  if (!name) return NextResponse.json({ message: '请填写巡演名称' }, { status: 400 })
  if (startDate === undefined || endDate === undefined) return NextResponse.json({ message: '巡演日期无效' }, { status: 400 })
  if (startDate && endDate && startDate > endDate) return NextResponse.json({ message: '结束日期不能早于开始日期' }, { status: 400 })
  if (sortOrder === undefined) return NextResponse.json({ message: '排序必须是非负整数' }, { status: 400 })
  const resolved = await resolveTourCategory(body)
  if ('error' in resolved) return NextResponse.json({ message: resolved.error }, { status: 400 })
  const tour = await prisma.musicTour.create({
    data: {
      name,
      subtitle: sanitizeText(body?.subtitle, 200) || null,
      description: sanitizeText(body?.description, 20_000) || null,
      posterUrl: sanitizeText(body?.coverUrl ?? body?.posterUrl, 1000) || null,
      startDate,
      endDate,
      category: resolved.category,
      categoryId: resolved.categoryId,
      sortOrder,
      status: parsePublicationStatus(body?.status),
    },
  })
  return NextResponse.json({ tour, message: '巡演已创建' }, { status: 201 })
}
