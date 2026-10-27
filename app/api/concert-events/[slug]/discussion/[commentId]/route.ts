import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, resolveRequestAuth, unauthenticatedResponse } from '@/lib/security'
import { safeEventSlug } from '@/lib/concert-events'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string; commentId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  if (!auth.user) return unauthenticatedResponse('登录后可以删除自己的评论')
  const limited = await enforceApiRateLimit(request, auth.user.id, {
    endpoint: '/api/concert-events/discussion/delete',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 10, windowSeconds: 60 },
  }, '操作过于频繁，请稍后再试')
  if (limited) return limited
  const { slug: rawSlug, commentId } = await params
  const slug = safeEventSlug(rawSlug)
  if (!slug || !commentId || commentId.length > 191) return NextResponse.json({ message: '评论不存在' }, { status: 404 })

  try {
    const event = await prisma.concertEvent.findUnique({ where: { slug }, select: { id: true } })
    if (!event) return NextResponse.json({ message: '评论不存在' }, { status: 404 })
    const comment = await prisma.concertDiscussionComment.findFirst({
      where: { id: commentId, eventId: event.id, authorId: auth.user.id, isDeleted: false },
      select: { id: true, eventId: true, showId: true },
    })
    if (!comment) return NextResponse.json({ message: '评论不存在或已删除' }, { status: 404 })

    const changed = await prisma.concertDiscussionComment.updateMany({
      where: { id: comment.id, eventId: comment.eventId, showId: comment.showId, authorId: auth.user.id, isDeleted: false },
      data: { isDeleted: true, deletedAt: new Date() },
    })
    if (changed.count !== 1) return NextResponse.json({ message: '评论状态已变化，请刷新后重试' }, { status: 409 })

    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[concert-discussion.delete]', {
      userId: auth.user.id,
      slug,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    })
    return NextResponse.json({ message: '删除失败，请稍后重试' }, { status: 503 })
  }
}
