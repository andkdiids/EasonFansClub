import type { NotificationType, Prisma, PrismaClient } from '@prisma/client'
import { createManyNotificationsWithDb } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'

type NotificationDb = PrismaClient | Prisma.TransactionClient

/**
 * STUDIO_REVIEW is the business event name. Personal moderation results use
 * the existing ADMIN notification type so ordinary users see them in the
 * notification center without adding another database enum value.
 */
export const STUDIO_REVIEW_NOTIFICATION_TYPE = 'ADMIN' satisfies NotificationType
export const CREATOR_REVIEW_NOTIFICATION_TYPE = 'REVIEW' satisfies NotificationType
export const CREATOR_REVIEW_PERMISSION = 'studio_manage' as const
export const CREATOR_REVIEW_NOTIFICATION_KEY_PREFIX = 'creator-review:'

export function creatorReviewNotificationKey(projectId: string, reviewVersion: string) {
  return `${CREATOR_REVIEW_NOTIFICATION_KEY_PREFIX}${projectId}:${reviewVersion}`
}

export function creatorReviewNotificationLink(projectId: string) {
  return `/admin/studio?projectId=${encodeURIComponent(projectId)}`
}

export function buildCreatorReviewNotificationContent(input: {
  nickname: string | null | undefined
  title: string | null | undefined
}) {
  const nickname = input.nickname?.trim() || '有用户'
  const title = input.title?.trim() || '未命名作品'
  return `${nickname} 提交了「${title}」，等待审核。`
}

export async function getCreatorReviewAdminIds(db: NotificationDb = prisma) {
  const admins = await db.user.findMany({
    where: {
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      status: 'ACTIVE',
      isDeleted: false,
      OR: [
        { role: 'SUPER_ADMIN' },
        { AdminPermission: { some: { permissionKey: CREATOR_REVIEW_PERMISSION, enabled: true } } },
      ],
    },
    select: { id: true },
  })
  return admins.map((admin) => admin.id)
}

export async function createCreatorReviewNotifications(input: {
  projectId: string
  authorId: string
  nickname: string | null | undefined
  title: string | null | undefined
  reviewVersion: string
}, db: NotificationDb = prisma) {
  const recipientIds = await getCreatorReviewAdminIds(db)
  if (!recipientIds.length) {
    console.warn('[CREATOR_REVIEW_NO_ADMIN_RECIPIENTS]', {
      submissionId: input.projectId,
      recipientAdminCount: 0,
      notificationType: CREATOR_REVIEW_NOTIFICATION_TYPE,
    })
    return recipientIds
  }

  const key = creatorReviewNotificationKey(input.projectId, input.reviewVersion)
  const result = await createManyNotificationsWithDb(db, {
    data: recipientIds.map((recipientId) => ({
      recipientId,
      actorId: input.authorId,
      type: CREATOR_REVIEW_NOTIFICATION_TYPE,
      title: '创作平台有新的待审核投稿',
      content: buildCreatorReviewNotificationContent(input),
      link: creatorReviewNotificationLink(input.projectId),
      key,
    })),
    skipDuplicates: true,
  }, {
    operation: 'creator-review.admin-notification',
    userId: input.authorId,
  })

  console.info('[CREATOR_REVIEW_NOTIFICATION_CREATED]', {
    submissionId: input.projectId,
    recipientAdminCount: recipientIds.length,
    notificationCreatedCount: result.count,
    notificationType: CREATOR_REVIEW_NOTIFICATION_TYPE,
  })
  return recipientIds
}

export type StudioReviewStatus = 'APPROVED' | 'REJECTED'

export function buildStudioReviewNotification(input: {
  projectId: string
  recipientId: string
  actorId: string
  title: string
  status: StudioReviewStatus
  reviewedAt: Date
}): Prisma.NotificationCreateArgs['data'] {
  const title = input.title.trim() || '未命名作品'
  const projectPath = encodeURIComponent(input.projectId)
  const approved = input.status === 'APPROVED'

  return {
    recipientId: input.recipientId,
    actorId: input.actorId,
    type: STUDIO_REVIEW_NOTIFICATION_TYPE,
    title: approved ? '拼豆作品审核通过' : '拼豆作品审核未通过',
    content: approved
      ? `你的拼豆作品「${title}」已通过审核，现在可以在创作广场展示。`
      : `你的拼豆作品「${title}」未通过审核。`,
    link: approved ? `/studio/project/${projectPath}` : `/studio/beads?project=${projectPath}`,
    key: `studio-review:${input.projectId}:${input.status}:${input.reviewedAt.getTime()}`,
  }
}
