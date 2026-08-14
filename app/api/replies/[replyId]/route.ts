import { NextResponse } from 'next/server'
import { reverseCommunityCommentRewards } from '@/lib/community-rewards'
import { prisma } from '@/lib/prisma'
import { isAdminUser } from '@/lib/admin-permissions'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ replyId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params
  const reply = await prisma.reply.findFirst({
    where: { id: replyId, isDeleted: false },
    select: { id: true, authorId: true, postId: true, Post: { select: { authorId: true } } },
  })

  if (!reply) return NextResponse.json({ message: '评论不存在' }, { status: 404 })

  const isOwner = reply.authorId === guard.user.id
  const isAllowedAdmin = isAdminUser(guard.user)
  if (!isOwner && !isAllowedAdmin) {
    return NextResponse.json({ message: '只能删除自己的评论' }, { status: 403 })
  }

  const threadRows = await prisma.reply.findMany({
    where: { postId: reply.postId, isDeleted: false },
    select: { id: true, parentId: true, authorId: true },
  })
  const collectDescendantIds = (parentId: string): string[] => {
    const children = threadRows.filter((item) => item.parentId === parentId)
    return children.flatMap((child) => [child.id, ...collectDescendantIds(child.id)])
  }
  const deleteIds = [reply.id, ...collectDescendantIds(reply.id)]

  const replyCount = await prisma.$transaction(async (tx) => {
    // Keep deletion and pinning in the same per-post lock order.
    await tx.$queryRaw`SELECT id FROM Post WHERE id = ${reply.postId} FOR UPDATE`
    await tx.reply.updateMany({
      where: { id: { in: deleteIds } },
      data: { isDeleted: true, isPinned: false, deletedAt: new Date() },
    })
    const count = await tx.reply.count({
      where: { postId: reply.postId, isDeleted: false },
    })
    await tx.post.update({
      where: { id: reply.postId },
      data: { replyCount: count },
    })

    if (isAllowedAdmin) {
      await tx.adminAction.create({
        data: {
          adminId: guard.user.id,
          replyId: reply.id,
          action: 'DELETE_REPLY',
          metadata: { deletedBy: 'admin' },
        },
      })

      for (const deletedReply of threadRows.filter((item) => deleteIds.includes(item.id))) {
        await reverseCommunityCommentRewards(tx, {
          commentId: deletedReply.id,
          postId: reply.postId,
          commenterId: deletedReply.authorId,
          postAuthorId: reply.Post.authorId,
        })
      }
    }

    return count
  })

  return NextResponse.json({ ok: true, replyCount })
}
