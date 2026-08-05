import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ id: string }> }

const BADGE_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  iconUrl: true,
  isActive: true,
  category: true,
  musicTourId: true,
  musicTour: { select: { id: true, name: true } },
} as const

/** 编辑徽章字段或切换启用状态。 */
export async function PATCH(request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { id } = await params

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ message: '请求无效' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if ('name' in body) {
    const name = sanitizeText(body.name, 40)
    if (!name) return NextResponse.json({ message: '名称不能为空' }, { status: 400 })
    data.name = name
  }
  if ('description' in body) data.description = sanitizeText(body.description, 200) || null
  if ('iconUrl' in body) data.iconUrl = typeof body.iconUrl === 'string' ? body.iconUrl.trim().slice(0, 500) : null
  if ('isActive' in body) data.isActive = !!body.isActive
  if ('musicTourId' in body) {
    const musicTourId =
      typeof body.musicTourId === 'string' && body.musicTourId.trim() ? body.musicTourId.trim() : null
    if (musicTourId) {
      const tour = await prisma.musicTour.findUnique({ where: { id: musicTourId }, select: { id: true } })
      if (!tour) return NextResponse.json({ message: '关联的巡演不存在' }, { status: 400 })
    }
    data.musicTourId = musicTourId
  }

  if (Object.keys(data).length === 0) return NextResponse.json({ message: '没有可更新的字段' }, { status: 400 })

  try {
    const badge = await prisma.badge.update({ where: { id }, data, select: BADGE_SELECT })
    revalidatePath('/admin/music/badges')
    return NextResponse.json({ badge })
  } catch {
    return NextResponse.json({ message: '更新失败，徽章可能不存在' }, { status: 404 })
  }
}

/** 删除徽章（其用户授予记录随级联一并清除）。 */
export async function DELETE(_request: Request, { params }: Context) {
  const guard = await requireAdmin('music_manage')
  if (!guard.user) return guard.response
  const { id } = await params

  try {
    await prisma.badge.delete({ where: { id } })
    revalidatePath('/admin/music/badges')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ message: '删除失败，徽章可能已被授予用户或不存在' }, { status: 400 })
  }
}
