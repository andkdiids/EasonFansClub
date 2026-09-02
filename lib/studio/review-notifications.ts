import type { NotificationType, Prisma } from '@prisma/client'

/**
 * STUDIO_REVIEW is the business event name. Personal moderation results use
 * the existing ADMIN notification type so ordinary users see them in the
 * notification center without adding another database enum value.
 */
export const STUDIO_REVIEW_NOTIFICATION_TYPE = 'ADMIN' satisfies NotificationType

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
