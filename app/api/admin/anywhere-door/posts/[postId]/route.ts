import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

type RouteContext = { params: Promise<{ postId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const body = await request.json().catch(() => null)
  const status = body?.status
  if (!['READY', 'HIDDEN', 'FAILED'].includes(status)) return NextResponse.json({ message: '状态无效' }, { status: 400 })
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(postId)) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
  const post = await prisma.socialPost.findUnique({ where: { id: postId }, select: { id: true } })
  if (!post) return NextResponse.json({ message: '动态不存在' }, { status: 404 })
  const updated = await prisma.socialPost.update({ where: { id: postId }, data: { status }, select: { id: true, status: true } })
  return NextResponse.json({ post: updated })
}
