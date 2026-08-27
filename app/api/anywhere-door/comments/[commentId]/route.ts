import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ commentId: string }> }

export async function DELETE(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  if (!(await canAccessAnywhereDoor(guard.user))) return NextResponse.json({ ok: false, code: 'FEATURE_DISABLED', message: '随意门当前未开放' }, { status: 404 })
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/anywhere-door/comments/[commentId]:DELETE',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 15, windowSeconds: 60 },
  })
  if (limited) return limited
  const { commentId } = await context.params
  if (!/^[a-zA-Z0-9_-]{1,191}$/.test(commentId)) return NextResponse.json({ message: '评论不存在' }, { status: 404 })
  const isAdmin = await hasAdminPermission(guard.user, 'social_manage')
  const comment = await prisma.socialPostComment.findUnique({ where: { id: commentId }, select: { id: true, authorId: true } })
  if (!comment) return NextResponse.json({ message: '评论不存在' }, { status: 404 })
  if (!isAdmin && comment.authorId !== guard.user.id) return NextResponse.json({ message: '无权删除该评论' }, { status: 403 })
  await prisma.socialPostComment.update({ where: { id: commentId }, data: { deletedAt: new Date() } })
  return NextResponse.json({ ok: true })
}
