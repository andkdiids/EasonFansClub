import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { adminAuditOperations } from '@/lib/admin-audit'
import type { SessionUser } from '@/lib/auth'

export type DeletePostActor = SessionUser

export type DeletePostInput = {
  postId: string
  actor: DeletePostActor
  /** 操作者是否拥有帖子管理权限（管理员/超级管理员）。决定越权拦截与审计写入。 */
  canManagePosts: boolean
  /** 删除原因（可选），写入审计 metadata，便于后台追溯批量/单帖删除来源。 */
  reason?: string | null
}

export type DeletePostAudit = {
  operatorId: string
  action: 'DELETE_POST'
  operationType: typeof adminAuditOperations.POST_DELETED
  targetType: 'POST'
  targetId: string
  targetTitle: string | null
  targetUserId: string
  targetUserName: string
  targetUserUid: number
  reason?: string | null
  metadata: Prisma.InputJsonValue
}

export type DeletePostResult = {
  post: { id: string; isDeleted: boolean; deletedAt: Date | null }
  audit: DeletePostAudit
}

/**
 * 统一帖子删除服务。
 *
 * 所有新增删除入口（详情页单删、个人主页单删、用户批量删自己的帖子、
 * 管理员批量删）都必须复用这一个函数，确保软删除、板块帖子数重算、
 * 归属校验与幂等（已删除）语义、审计字段完全一致。
 *
 * 注意：本函数只负责「执行删除事务」并返回审计描述，不会主动写入
 * AdminAction 审计记录，也不做缓存失效（revalidate）。由调用方在
 * 拥有管理权限时写入审计（沿用既有 postDeleteResponse 的语义），以
 * 便在批量/单帖场景下灵活控制审计与缓存刷新时机。
 */
export async function deletePost({ postId, actor, canManagePosts, reason }: DeletePostInput): Promise<DeletePostResult> {
  const existing = await prisma.post.findUnique({
    where: { id: postId },
    select: { id: true, authorId: true, isDeleted: true },
  })
  if (!existing || existing.isDeleted) throw new Error(existing ? 'POST_ALREADY_DELETED' : 'POST_NOT_FOUND')
  if (existing.authorId !== actor.id && !canManagePosts) throw new Error('POST_DELETE_FORBIDDEN')

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT \`id\` FROM \`Post\` WHERE \`id\` = ${postId} FOR UPDATE`
    const lockedExisting = await tx.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        boardId: true,
        isDeleted: true,
        title: true,
        User: { select: { uid: true, nickname: true, Profile: { select: { displayName: true } } } },
      },
    })
    if (!lockedExisting) throw new Error('POST_NOT_FOUND')
    if (lockedExisting.isDeleted) throw new Error('POST_ALREADY_DELETED')
    if (lockedExisting.authorId !== actor.id && !canManagePosts) throw new Error('POST_DELETE_FORBIDDEN')

    const post = await tx.post.update({
      where: { id: postId },
      data: { isDeleted: true, deletedAt: new Date(), profilePinnedAt: null },
      select: { id: true, isDeleted: true, deletedAt: true },
    })
    const postCount = await tx.post.count({
      where: { boardId: lockedExisting.boardId, status: 'PUBLISHED', isDeleted: false, moderationStatus: 'APPROVED' },
    })
    await tx.board.update({ where: { id: lockedExisting.boardId }, data: { postCount } })

    return {
      post,
      audit: {
        operatorId: actor.id,
        action: 'DELETE_POST' as const,
        operationType: adminAuditOperations.POST_DELETED,
        targetType: 'POST',
        targetId: postId,
        targetTitle: lockedExisting.title,
        targetUserId: lockedExisting.authorId,
        targetUserName: lockedExisting.User.nickname || 'E院用户',
        targetUserUid: lockedExisting.User.uid,
        reason: reason ?? null,
        metadata: { isDeleted: true, reason: reason ?? null },
      },
    }
  })
}
