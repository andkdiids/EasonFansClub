import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hasAdminPermission, isAdminUser } from '@/lib/admin-permissions'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ replyId: string }> }

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params
  const reply = await prisma.reply.findFirst({
    where: { id: replyId, isDeleted: false },
    select: { id: true, authorId: true, postId: true },
  })

  if (!reply) return NextResponse.json({ message: '评论不存在' }, { status: 404 })

  const isOwner = reply.authorId === guard.user.id
  const isAllowedAdmin = isAdminUser(guard.user) && (await hasAdminPermission(guard.user, 'reply_manage'))
  if (!isOwner && !isAllowedAdmin) {
    return NextResponse.json({ message: '无权删除这条评论' }, { status: 403 })
  }

  const replyCount = await prisma.$transaction(async (tx) => {
    await tx.reply.update({
      where: { id: reply.id },
      data: { isDeleted: true, deletedAt: new Date() },
    })
    const count = await tx.reply.count({
      where: { postId: reply.postId, isDeleted: false },
    })
    await tx.post.update({
      where: { id: reply.postId },
      data: { replyCount: count },
    })

    if (!isOwner) {
      await tx.adminAction.create({
        data: {
          adminId: guard.user.id,
          replyId: reply.id,
          action: 'DELETE_REPLY',
          metadata: { deletedBy: 'admin' },
        },
      })
    }

    return count
  })

  return NextResponse.json({ ok: true, replyCount })
}
