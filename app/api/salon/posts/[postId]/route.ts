import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'
import { getSalonPostForViewer, parseSalonCategory } from '@/lib/salon'
import { prisma } from '@/lib/prisma'
import { requireUser, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: RouteContext) {
  const { postId } = await context.params
  const user = await getCurrentUser()
  const canModerate = Boolean(user && await hasAdminPermission(user, 'post_manage').catch(() => false))
  const post = await getSalonPostForViewer(postId, user?.id, canModerate)
  if (!post) return NextResponse.json({ ok: false, message: '作品不存在或当前不可查看' }, { status: 404 })
  return NextResponse.json({ ok: true, post }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const post = await prisma.salonPost.findUnique({ where: { id: postId }, select: { id: true, userId: true } })
  if (!post) return NextResponse.json({ ok: false, message: '作品不存在或已经删除' }, { status: 404 })
  const canModerate = await hasAdminPermission(guard.user, 'post_manage')
  if (!canModerate && post.userId !== guard.user.id) return NextResponse.json({ ok: false, message: '只能删除自己的沙龙作品' }, { status: 403 })

  await prisma.salonPost.delete({ where: { id: postId } })
  revalidatePath('/salon')
  revalidatePath('/salon/mine')
  revalidatePath(`/salon/${postId}`)
  return NextResponse.json({ ok: true, message: '沙龙作品已删除' })
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const canModerate = await hasAdminPermission(guard.user, 'post_manage')
  if (!canModerate) return NextResponse.json({ ok: false, message: '没有修改沙龙作品的权限' }, { status: 403 })
  const { postId } = await context.params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, message: '请求内容无效' }, { status: 400 })

  const data: { category?: 'CONCERT' | 'MOBILE_WALLPAPER' | 'DESKTOP_WALLPAPER'; concertId?: string; title?: string | null; content?: string | null } = {}
  if (Object.prototype.hasOwnProperty.call(body, 'category')) {
    const category = parseSalonCategory(body.category)
    if (!category) return NextResponse.json({ ok: false, message: '投稿分类无效' }, { status: 400 })
    data.category = category
  }
  if (Object.prototype.hasOwnProperty.call(body, 'concertId')) {
    const concertId = sanitizeText(body.concertId, 191)
    if (!concertId) return NextResponse.json({ ok: false, message: '请选择对应的演唱会场次' }, { status: 400 })
    const concert = await prisma.musicConcert.findFirst({ where: { id: concertId, status: 'PUBLISHED', MusicTour: { status: 'PUBLISHED' } }, select: { id: true } })
    if (!concert) return NextResponse.json({ ok: false, message: '演唱会场次不存在或暂未公开' }, { status: 400 })
    data.concertId = concert.id
  }
  if (Object.prototype.hasOwnProperty.call(body, 'title')) data.title = sanitizeText(body.title, 200) || null
  if (Object.prototype.hasOwnProperty.call(body, 'content')) data.content = sanitizeText(body.content, 5000) || null
  if (!Object.keys(data).length) return NextResponse.json({ ok: false, message: '没有需要更新的内容' }, { status: 400 })

  const updated = await prisma.salonPost.update({ where: { id: postId }, data, select: { id: true } }).catch(() => null)
  if (!updated) return NextResponse.json({ ok: false, message: '作品不存在或更新失败' }, { status: 404 })
  revalidatePath('/salon')
  revalidatePath('/salon/mine')
  revalidatePath(`/salon/${postId}`)
  return NextResponse.json({ ok: true, message: '沙龙作品已更新' })
}
