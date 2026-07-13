import { NextResponse } from 'next/server'
import { isAdminUser } from '@/lib/admin-permissions'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ commentId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { commentId } = await context.params
  const comment = await prisma.dailyMessageComment.findFirst({
    where: { id: commentId, isDeleted: false },
    select: { id: true, authorId: true, messageId: true },
  })

  if (!comment) return NextResponse.json({ message: '评论不存在' }, { status: 404 })

  const isOwner = comment.authorId === guard.user.id
  const isAllowedAdmin = isAdminUser(guard.user)
  if (!isOwner && !isAllowedAdmin) {
    return NextResponse.json({ message: '只能删除自己的留言评论' }, { status: 403 })
  }

  const threadRows = await prisma.dailyMessageComment.findMany({
    where: { messageId: comment.messageId, isDeleted: false },
    select: { id: true, parentId: true },
  })
  const collectDescendantIds = (parentId: string): string[] => {
    const children = threadRows.filter((item) => item.parentId === parentId)
    return children.flatMap((child) => [child.id, ...collectDescendantIds(child.id)])
  }
  const deleteIds = [comment.id, ...collectDescendantIds(comment.id)]

  const commentCount = await prisma.$transaction(async (tx) => {
    await tx.dailyMessageComment.updateMany({
      where: { id: { in: deleteIds } },
      data: { isDeleted: true, deletedAt: new Date() },
    })
    const count = await tx.dailyMessageComment.count({
      where: { messageId: comment.messageId, isDeleted: false },
    })
    await tx.dailyMessage.update({
      where: { id: comment.messageId },
      data: { commentCount: count },
    })
    return count
  })

  return NextResponse.json({ ok: true, commentCount })
}
