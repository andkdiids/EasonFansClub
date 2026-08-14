import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { canPinPostReply } from '@/lib/post-replies'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ replyId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params
  const body = await request.json().catch(() => null) as { pinned?: unknown } | null
  if (typeof body?.pinned !== 'boolean') {
    return NextResponse.json({ message: '置顶状态不正确' }, { status: 400 })
  }

  const result = await prisma.$transaction(async (tx) => {
    const reply = await tx.reply.findFirst({
      where: { id: replyId, isDeleted: false },
      select: {
        id: true,
        postId: true,
        parentId: true,
        isPinned: true,
        Post: { select: { authorId: true } },
      },
    })
    if (!reply) return { kind: 'not-found' as const }
    if (reply.parentId !== null) return { kind: 'not-root' as const }
    if (!canPinPostReply({ currentUserId: guard.user.id, postAuthorId: reply.Post.authorId, parentId: reply.parentId })) {
      return { kind: 'forbidden' as const }
    }

    // Serialise pin operations per post so two concurrent requests cannot leave two pinned roots.
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${reply.postId} FOR UPDATE`
    if (body.pinned) {
      await tx.reply.updateMany({
        where: { postId: reply.postId, parentId: null, isDeleted: false, isPinned: true },
        data: { isPinned: false },
      })
      await tx.reply.update({ where: { id: reply.id }, data: { isPinned: true } })
    } else {
      await tx.reply.update({ where: { id: reply.id }, data: { isPinned: false } })
    }

    return { kind: 'ok' as const, isPinned: body.pinned }
  })

  if (result.kind === 'not-found') return NextResponse.json({ message: '评论不存在' }, { status: 404 })
  if (result.kind === 'not-root') return NextResponse.json({ message: '只能置顶一级评论' }, { status: 403 })
  if (result.kind === 'forbidden') return NextResponse.json({ message: '只有帖子作者可以置顶评论' }, { status: 403 })

  return NextResponse.json({ ok: true, isPinned: result.isPinned }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
