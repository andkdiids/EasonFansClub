import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

/** 列出全部徽章（含分类与关联巡演），供后台管理页展示。 */
export async function GET() {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const badges = await prisma.badge.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      iconUrl: true,
      isActive: true,
      category: true,
      musicTourId: true,
      musicTour: { select: { id: true, name: true } },
    },
  })
  return NextResponse.json({ badges })
}

/** 创建演唱会纪念徽章（category 固定为 CONCERT，必须关联巡演）。 */
export async function POST(request: Request) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ message: '请求无效' }, { status: 400 })

  const name = sanitizeText(body.name, 40)
  const description = sanitizeText(body.description, 200)
  const iconUrl = typeof body.iconUrl === 'string' && body.iconUrl.trim() ? body.iconUrl.trim().slice(0, 500) : null
  const isActive = body.isActive !== false
  const musicTourId =
    typeof body.musicTourId === 'string' && body.musicTourId.trim() ? body.musicTourId.trim() : null

  if (!name) return NextResponse.json({ message: '请填写徽章名称' }, { status: 400 })
  if (!musicTourId) return NextResponse.json({ message: '请选择关联的巡演' }, { status: 400 })

  const tour = await prisma.musicTour.findUnique({ where: { id: musicTourId }, select: { id: true } })
  if (!tour) return NextResponse.json({ message: '关联的巡演不存在' }, { status: 400 })

  const slug =
    typeof body.slug === 'string' && body.slug.trim()
      ? body.slug.trim().toLowerCase()
      : `concert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  try {
    const badge = await prisma.badge.create({
      data: {
        name,
        slug,
        description: description || null,
        iconUrl,
        category: 'CONCERT',
        musicTourId,
        isActive,
        isAutoGrant: false,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        iconUrl: true,
        isActive: true,
        category: true,
        musicTourId: true,
        musicTour: { select: { id: true, name: true } },
      },
    })
    revalidatePath('/admin/music/badges')
    return NextResponse.json({ badge }, { status: 201 })
  } catch (error) {
    const duplicated =
      error instanceof Error && /Unique constraint|P2002/i.test(error.message)
    return NextResponse.json(
      { message: duplicated ? '创建失败，名称或标识可能已存在' : '创建失败，请稍后重试' },
      { status: duplicated ? 409 : 500 },
    )
  }
}
