import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { getConcertCategories, isReservedCategorySlug, slugifyCategoryName, ensureUniqueCategorySlug } from '@/lib/music-concert-category'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const categories = await getConcertCategories().catch(() => [])
  return NextResponse.json({ categories })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const name = sanitizeText(body?.name, 40)
  if (!name) return NextResponse.json({ message: '请填写分类名称' }, { status: 400 })

  // 自动生成 slug：优先使用用户填写的标识，否则根据中文分类名自动推导（允许中文，保证唯一）。
  const providedSlug = sanitizeText(body?.slug, 40)
  const slugBase = slugifyCategoryName(providedSlug || name)
  if (isReservedCategorySlug(slugBase)) return NextResponse.json({ message: '该标识为核心分类，不可创建重复项' }, { status: 400 })
  const slug = await ensureUniqueCategorySlug(slugBase)

  const sortOrder = Number.isFinite(Number(body?.sortOrder)) ? Number(body?.sortOrder) : 0
  const enabled = body?.enabled === undefined ? true : Boolean(body?.enabled)

  const category = await prisma.musicConcertCategory.create({
    data: { name, slug, sortOrder, enabled },
    select: { id: true, name: true, slug: true, sortOrder: true, enabled: true },
  })
  return NextResponse.json({ category, message: '分类已创建' }, { status: 201 })
}
