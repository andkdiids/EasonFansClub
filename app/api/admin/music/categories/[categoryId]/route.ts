import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { isReservedCategorySlug } from '@/lib/music-concert-category'

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

export async function PATCH(request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { categoryId } = await params
  const body = await request.json().catch(() => null)
  const current = await prisma.musicConcertCategory.findUnique({ where: { id: categoryId } }).catch(() => null)
  if (!current) return NextResponse.json({ message: '分类不存在' }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (body?.name !== undefined) {
    const name = sanitizeText(body.name, 40)
    if (!name) return NextResponse.json({ message: '分类名称不能为空' }, { status: 400 })
    data.name = name
  }
  if (body?.slug !== undefined) {
    const nextSlug = slugify(sanitizeText(body.slug, 40) || current.slug)
    if (!isValidSlug(nextSlug)) return NextResponse.json({ message: '分类标识（slug）只能包含小写字母、数字与连字符' }, { status: 400 })
    // 核心分类的 slug 不可改为其它值（保持与 enum 的绑定）。
    if (isReservedCategorySlug(current.slug) && nextSlug !== current.slug) {
      return NextResponse.json({ message: '核心分类标识不可修改' }, { status: 400 })
    }
    if (nextSlug !== current.slug) {
      const clash = await prisma.musicConcertCategory.findUnique({ where: { slug: nextSlug } }).catch(() => null)
      if (clash) return NextResponse.json({ message: '分类标识已存在' }, { status: 409 })
      data.slug = nextSlug
    }
  }
  if (body?.sortOrder !== undefined) {
    if (!Number.isFinite(Number(body.sortOrder))) return NextResponse.json({ message: '排序必须为数字' }, { status: 400 })
    data.sortOrder = Number(body.sortOrder)
  }
  if (body?.enabled !== undefined) data.enabled = Boolean(body.enabled)

  const category = await prisma.musicConcertCategory.update({
    where: { id: categoryId },
    data,
    select: { id: true, name: true, slug: true, sortOrder: true, enabled: true },
  })
  return NextResponse.json({ category, message: '分类已更新' })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { categoryId } = await params
  const current = await prisma.musicConcertCategory.findUnique({ where: { id: categoryId } }).catch(() => null)
  if (!current) return NextResponse.json({ message: '分类不存在' }, { status: 404 })
  // 核心分类（与 enum 绑定）禁止删除。
  if (isReservedCategorySlug(current.slug)) {
    return NextResponse.json({ message: '核心分类（大型演唱会 / 小型企划 / 嘉宾现场）不可删除' }, { status: 409 })
  }
  await prisma.musicConcertCategory.delete({ where: { id: categoryId } }).catch(() => null)
  return NextResponse.json({ message: '分类已删除' })
}
