import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { collectSalonCommentThreadIds } from '@/lib/salon'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ commentId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { commentId } = await context.params
  const comment = await prisma.salonComment.findUnique({ where: { id: commentId }, select: { id: true, postId: true, authorId: true, isDeleted: true } })
  if (!comment || comment.isDeleted) return NextResponse.json({ ok: false, message: '评论不存在或已经删除' }, { status: 404 })
  const canModerate = await hasAdminPermission(guard.user, 'post_manage')
  if (!canModerate && comment.authorId !== guard.user.id) return NextResponse.json({ ok: false, message: '只能删除自己的评论' }, { status: 403 })

  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.salonComment.findMany({ where: { postId: comment.postId, isDeleted: false }, select: { id: true, parentId: true, authorId: true } })
    const deleteIds = collectSalonCommentThreadIds(rows, commentId)
    const deleted = await tx.salonComment.updateMany({ where: { id: { in: deleteIds }, isDeleted: false }, data: { isDeleted: true, deletedAt: new Date() } })
    const commentCount = await tx.salonComment.count({ where: { postId: comment.postId, isDeleted: false } })
    await tx.salonPost.update({ where: { id: comment.postId }, data: { commentCount }, select: { id: true } })
    return { count: deleted.count, commentCount }
  })
  if (!result.count) return NextResponse.json({ ok: false, message: '评论不存在或已经删除' }, { status: 404 })
  return NextResponse.json({ ok: true, commentCount: result.commentCount, message: '评论已删除' })
}
