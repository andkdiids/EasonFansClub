import { Prisma } from '@prisma/client'
import { NextResponse } from 'next/server'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { reverseCommunityCommentRewards } from '@/lib/community-rewards'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

type RouteContext = { params: Promise<{ replyId: string }> }

function redactReplyDeleteErrorText(value: string) {
  return value
    .replace(/\b(?:mysql|mariadb|postgres(?:ql)?|prisma(?:\+postgres)?):\/\/[^\s'\"]+/gi, (match) => `${match.slice(0, match.indexOf('://') + 3)}[redacted]`)
    .replace(/\b(password|passwd|secret|token|cookie|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
}

function safeReplyDeleteErrorMeta(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 20).map(([key, item]) => {
    if (/authorization|cookie|database|password|secret|token|url/i.test(key)) return [key, '[redacted]']
    if (typeof item === 'string') return [key, redactReplyDeleteErrorText(item).slice(0, 500)]
    return [key, item]
  }))
}

function describeReplyDeleteError(error: unknown) {
  const knownError = error instanceof Prisma.PrismaClientKnownRequestError
  return {
    errorName: error instanceof Error ? error.name : 'UnknownError',
    errorCode: knownError ? error.code : undefined,
    meta: knownError ? safeReplyDeleteErrorMeta(error.meta) : undefined,
    message: redactReplyDeleteErrorText(error instanceof Error ? error.message : String(error)),
  }
}

function replyDeleteErrorResponse(error: unknown, replyId: string, userId: string) {
  const errorMessage = error instanceof Error ? error.message : ''
  const errorCode = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined
  console.error('[post-replies.delete]', { replyId, userId, ...describeReplyDeleteError(error) })

  if (errorMessage === 'REPLY_DELETE_FORBIDDEN') {
    return NextResponse.json({ message: '只能删除自己的评论' }, { status: 403 })
  }
  if (errorMessage === 'REPLY_NOT_FOUND' || errorMessage === 'REPLY_ALREADY_DELETED' || errorCode === 'P2025') {
    return NextResponse.json({ message: '评论不存在或已经被删除' }, { status: 404 })
  }
  return NextResponse.json({ message: '删除评论失败，请稍后重试' }, { status: 500 })
}

function collectThreadIds(rows: Array<{ id: string; parentId: string | null }>, rootId: string) {
  const childrenByParent = new Map<string, string[]>()
  for (const row of rows) {
    if (!row.parentId) continue
    const children = childrenByParent.get(row.parentId) || []
    children.push(row.id)
    childrenByParent.set(row.parentId, children)
  }

  const ids = [rootId]
  const seen = new Set(ids)
  const pending = [rootId]
  while (pending.length) {
    const parentId = pending.shift()!
    for (const childId of childrenByParent.get(parentId) || []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      ids.push(childId)
      pending.push(childId)
    }
  }
  return ids
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { replyId } = await context.params

  try {
    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
      select: {
        id: true,
        authorId: true,
        postId: true,
        isDeleted: true,
        Post: { select: { authorId: true } },
      },
    })
    if (!reply) throw new Error('REPLY_NOT_FOUND')

    const canManageReplies = await hasAdminPermission(guard.user, 'reply_manage')
    const isOwner = reply.authorId === guard.user.id
    if (!isOwner && !canManageReplies) throw new Error('REPLY_DELETE_FORBIDDEN')
    if (reply.isDeleted) throw new Error('REPLY_ALREADY_DELETED')

    const result = await prisma.$transaction(async (tx) => {
      // Keep reply deletion in the same per-post lock order as pinning and
      // reply creation, so two moderators cannot delete different snapshots.
      await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${reply.postId} FOR UPDATE`

      const lockedReply = await tx.reply.findUnique({
        where: { id: replyId },
        select: { id: true, postId: true, isDeleted: true },
      })
      if (!lockedReply || lockedReply.postId !== reply.postId) throw new Error('REPLY_NOT_FOUND')
      if (lockedReply.isDeleted) throw new Error('REPLY_ALREADY_DELETED')

      const threadRows = await tx.reply.findMany({
        where: { postId: reply.postId, isDeleted: false },
        select: { id: true, parentId: true, authorId: true },
      })
      const deleteIds = collectThreadIds(threadRows, replyId)
      const deleted = await tx.reply.updateMany({
        where: { id: { in: deleteIds }, isDeleted: false },
        data: { isDeleted: true, isPinned: false, deletedAt: new Date() },
      })
      if (!deleted.count) throw new Error('REPLY_ALREADY_DELETED')

      const replyCount = await tx.reply.count({
        where: { postId: reply.postId, isDeleted: false },
      })
      await tx.post.update({
        where: { id: reply.postId },
        data: { replyCount },
      })

      // Existing business rules only reverse community rewards for moderator
      // deletion. User self-deletion keeps the prior reward behavior.
      if (canManageReplies) {
        for (const deletedReply of threadRows.filter((row) => deleteIds.includes(row.id))) {
          await reverseCommunityCommentRewards(tx, {
            commentId: deletedReply.id,
            postId: reply.postId,
            commenterId: deletedReply.authorId,
            postAuthorId: reply.Post.authorId,
          })
        }
      }

      return { replyCount, deletedReplyIds: deleteIds }
    })

    if (canManageReplies) {
      try {
        // Audit failure must not undo the committed content deletion. The
        // failure is logged with the reply id for later reconciliation.
        await prisma.$transaction((tx) => tx.adminAction.create({
          data: {
            adminId: guard.user.id,
            replyId,
            action: 'DELETE_REPLY',
            metadata: { deletedBy: 'admin', deletedReplyIds: result.deletedReplyIds },
          },
        }))
      } catch (error) {
        console.error('[post-replies.delete.audit]', { replyId, userId: guard.user.id, ...describeReplyDeleteError(error) })
      }
    }

    return NextResponse.json({ ok: true, replyCount: result.replyCount, message: '评论已删除' })
  } catch (error) {
    return replyDeleteErrorResponse(error, replyId, guard.user.id)
  }
}
