import type { AdminActionType, Prisma } from '@prisma/client'
import { describePostModerationHistoryError, isMissingPostModerationHistoryTableError } from '@/lib/post-moderation-history'

/** Stable operation names used by the admin operation log UI and filters. */
export const adminAuditOperations = {
  POST_REVIEW_APPROVED: 'POST_REVIEW_APPROVED',
  POST_REVIEW_REJECTED: 'POST_REVIEW_REJECTED',
  POST_FEATURED: 'POST_FEATURED',
  POST_UNFEATURED: 'POST_UNFEATURED',
  POST_PINNED: 'POST_PINNED',
  POST_UNPINNED: 'POST_UNPINNED',
  POST_DELETED: 'POST_DELETED',
  POST_RESTORED: 'POST_RESTORED',
  POST_EDITED: 'POST_EDITED',
  ECENTER_FEATURES_UPDATED: 'ECENTER_FEATURES_UPDATED',
  ACTIVITY_CREATE: 'ACTIVITY_CREATE',
  ACTIVITY_UPDATE: 'ACTIVITY_UPDATE',
  ACTIVITY_PUBLISH: 'ACTIVITY_PUBLISH',
  ACTIVITY_UNPUBLISH: 'ACTIVITY_UNPUBLISH',
  ACTIVITY_CANCEL: 'ACTIVITY_CANCEL',
  ACTIVITY_DELETE: 'ACTIVITY_DELETE',
  ACTIVITY_FORM_UPDATE: 'ACTIVITY_FORM_UPDATE',
  ACTIVITY_REWARD_UPDATE: 'ACTIVITY_REWARD_UPDATE',
  ACTIVITY_REGISTRATION_CANCEL: 'ACTIVITY_REGISTRATION_CANCEL',
  ACTIVITY_REGISTRATION_VERIFY: 'ACTIVITY_REGISTRATION_VERIFY',
  ACTIVITY_LOTTERY_CREATE: 'ACTIVITY_LOTTERY_CREATE',
  ACTIVITY_LOTTERY_UPDATE: 'ACTIVITY_LOTTERY_UPDATE',
  ACTIVITY_LOTTERY_CANCEL: 'ACTIVITY_LOTTERY_CANCEL',
  ACTIVITY_LOTTERY_DRAW: 'ACTIVITY_LOTTERY_DRAW',
  ACTIVITY_LOTTERY_MANUAL_DRAW: 'LOTTERY_MANUAL_DRAW',
  ACTIVITY_REDEMPTION_CONFIRM: 'ACTIVITY_REDEMPTION_CONFIRM',
} as const

export type AdminAuditOperation = typeof adminAuditOperations[keyof typeof adminAuditOperations]

export const adminAuditOperationLabels: Record<AdminAuditOperation, string> = {
  POST_REVIEW_APPROVED: '审核通过帖子',
  POST_REVIEW_REJECTED: '审核拒绝帖子',
  POST_FEATURED: '设置精华',
  POST_UNFEATURED: '取消精华',
  POST_PINNED: '置顶帖子',
  POST_UNPINNED: '取消置顶',
  POST_DELETED: '删除帖子',
  POST_RESTORED: '恢复帖子',
  POST_EDITED: '管理员编辑帖子',
  ECENTER_FEATURES_UPDATED: '更新 E院中心功能入口',
  ACTIVITY_CREATE: '创建活动',
  ACTIVITY_UPDATE: '编辑活动',
  ACTIVITY_PUBLISH: '发布活动',
  ACTIVITY_UNPUBLISH: '撤下活动',
  ACTIVITY_CANCEL: '取消活动',
  ACTIVITY_DELETE: '删除活动',
  ACTIVITY_FORM_UPDATE: '更新活动报名表',
  ACTIVITY_REWARD_UPDATE: '更新活动核销奖励',
  ACTIVITY_REGISTRATION_CANCEL: '取消活动报名',
  ACTIVITY_REGISTRATION_VERIFY: '核销活动报名',
  ACTIVITY_LOTTERY_CREATE: '创建活动抽奖',
  ACTIVITY_LOTTERY_UPDATE: '编辑活动抽奖',
  ACTIVITY_LOTTERY_CANCEL: '取消活动抽奖',
  ACTIVITY_LOTTERY_DRAW: '活动抽奖开奖',
  LOTTERY_MANUAL_DRAW: '管理员立即开奖',
  ACTIVITY_REDEMPTION_CONFIRM: '确认活动权益核销',
}

type AuditDatabaseClient = Pick<Prisma.TransactionClient, 'user' | 'adminAction' | 'postModerationHistory'>

type UserSnapshot = {
  id: string
  uid: number
  username: string
  nickname: string
  Profile: { displayName: string | null } | null
}

const userSnapshotSelect = {
  id: true,
  uid: true,
  username: true,
  nickname: true,
  Profile: { select: { displayName: true } },
} as const

export async function getAuditUserSnapshot(tx: AuditDatabaseClient, userId: string): Promise<UserSnapshot> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: userSnapshotSelect })
  if (!user) throw new Error('AUDIT_OPERATOR_NOT_FOUND')
  return user
}

export function userSnapshotName(user: Pick<UserSnapshot, 'nickname' | 'Profile'>) {
  return user.nickname?.trim() || 'E院用户'
}

export async function createAdminActionAudit(
  tx: AuditDatabaseClient,
  input: {
    operatorId: string
    action: AdminActionType
    operationType: AdminAuditOperation
    targetType: string
    targetId: string
    targetTitle?: string | null
    targetUserId?: string | null
    targetUserName?: string | null
    targetUserUid?: number | null
    reason?: string | null
    metadata?: Prisma.InputJsonValue
  },
) {
  const operator = await getAuditUserSnapshot(tx, input.operatorId)
  return tx.adminAction.create({
    data: {
      adminId: operator.id,
      operatorName: userSnapshotName(operator),
      operatorUsername: operator.username,
      operatorUid: operator.uid,
      action: input.action,
      operationType: input.operationType,
      targetType: input.targetType,
      targetId: input.targetId,
      targetTitle: input.targetTitle || null,
      targetUserId: input.targetUserId || null,
      targetUserName: input.targetUserName || null,
      targetUserUid: input.targetUserUid ?? null,
      postId: input.targetType === 'POST' ? input.targetId : null,
      reason: input.reason || null,
      result: 'SUCCESS',
      metadata: input.metadata,
    },
  })
}

export type PostModerationHistoryAction = 'SUBMITTED' | 'EDITED' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED'

export async function createPostModerationHistory(
  tx: AuditDatabaseClient,
  input: {
    postId: string
    actorId: string
    action: PostModerationHistoryAction
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'VIOLATION'
    titleSnapshot?: string | null
    rejectionReason?: string | null
  },
) {
  try {
    const actor = await getAuditUserSnapshot(tx, input.actorId)
    return await tx.postModerationHistory.create({
      data: {
        postId: input.postId,
        actorId: actor.id,
        actorName: userSnapshotName(actor),
        actorUsername: actor.username,
        actorUid: actor.uid,
        action: input.action,
        status: input.status,
        titleSnapshot: input.titleSnapshot || null,
        rejectionReason: input.rejectionReason || null,
      },
    })
  } catch (error) {
    if (!isMissingPostModerationHistoryTableError(error)) throw error
    console.error('[post-moderation-history.write]', {
      postId: input.postId,
      action: input.action,
      status: input.status,
      optionalTableMissing: true,
      error: describePostModerationHistoryError(error),
    })
    return null
  }
}
