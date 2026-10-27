import { NextResponse } from 'next/server'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('activity_manage', request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    endpoint: '/api/admin/concert-discussions/delete',
    ip: { limit: 30, windowSeconds: 60 },
    user: { limit: 20, windowSeconds: 60 },
  }, '操作过于频繁，请稍后再试')
  if (limited) return limited

  const { commentId } = await params
  if (!commentId || commentId.length > 191) return NextResponse.json({ message: '评论不存在' }, { status: 404 })
  try {
    const comment = await prisma.concertDiscussionComment.findFirst({
      where: { id: commentId, isDeleted: false },
      select: { id: true, eventId: true, showId: true, authorId: true, parentCommentId: true },
    })
    if (!comment) return NextResponse.json({ message: '评论不存在或已删除' }, { status: 404 })
    const deleted = await prisma.$transaction(async (tx) => {
      const changed = await tx.concertDiscussionComment.updateMany({
        where: { id: comment.id, eventId: comment.eventId, showId: comment.showId, isDeleted: false },
        data: { isDeleted: true, deletedAt: new Date() },
      })
      if (changed.count !== 1) return false
      if (!comment.parentCommentId) {
        await tx.concertDiscussionComment.updateMany({
          where: { parentCommentId: comment.id, eventId: comment.eventId, showId: comment.showId, isDeleted: false },
          data: { isDeleted: true, deletedAt: new Date() },
        })
      }
      await createAdminActionAudit(tx, {
        operatorId: guard.user!.id,
        action: 'DELETE_REPLY',
        operationType: adminAuditOperations.CONCERT_DISCUSSION_DELETE,
        targetType: 'CONCERT_DISCUSSION_COMMENT',
        targetId: comment.id,
        targetTitle: 'Recording Sessions 评论',
        targetUserId: comment.authorId,
        metadata: { eventId: comment.eventId, showId: comment.showId },
      })
      return true
    })
    if (!deleted) return NextResponse.json({ message: '评论状态已变化，请刷新后重试' }, { status: 409 })
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[admin.concert-discussions.delete]', {
      operatorId: guard.user.id,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^P\d{4}$/.test(error.code) ? error.code : undefined,
    })
    return NextResponse.json({ message: '删除失败，请稍后重试' }, { status: 503 })
  }
}
