import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { getConcertCategories, isReservedCategorySlug } from '@/lib/music-concert-category'

export const dynamic = 'force-dynamic'

function slugify(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9一-龥]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function isValidSlug(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value)
}

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

  const rawSlug = sanitizeText(body?.slug, 40) || slugify(name)
  const slug = slugify(rawSlug)
  if (!isValidSlug(slug)) return NextResponse.json({ message: '分类标识（slug）只能包含小写字母、数字与连字符，且以字母或数字开头' }, { status: 400 })
  if (isReservedCategorySlug(slug)) return NextResponse.json({ message: '该标识为核心分类，不可创建重复项' }, { status: 400 })

  const existing = await prisma.musicConcertCategory.findUnique({ where: { slug } }).catch(() => null)
  if (existing) return NextResponse.json({ message: '分类标识已存在' }, { status: 409 })

  const sortOrder = Number.isFinite(Number(body?.sortOrder)) ? Number(body?.sortOrder) : 0
  const enabled = body?.enabled === undefined ? true : Boolean(body?.enabled)

  const category = await prisma.musicConcertCategory.create({
    data: { name, slug, sortOrder, enabled },
    select: { id: true, name: true, slug: true, sortOrder: true, enabled: true },
  })
  return NextResponse.json({ category, message: '分类已创建' }, { status: 201 })
}
