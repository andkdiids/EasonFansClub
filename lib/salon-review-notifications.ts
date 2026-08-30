import type { Prisma, PrismaClient } from '@prisma/client'
import { createManyNotificationsWithDb } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { salonCategoryLabel } from '@/lib/salon'

type NotificationDb = PrismaClient | Prisma.TransactionClient

export const SALON_REVIEW_NOTIFICATION_TITLE = '新的沙龙投稿待审核'
export const SALON_REVIEW_NOTIFICATION_KEY_PREFIX = 'salon-review:'
export const SALON_REVIEW_PERMISSION = 'post_manage' as const

export type SalonReviewStatus = 'APPROVED' | 'REJECTED'

export function salonReviewNotificationKey(postId: string) {
  return `${SALON_REVIEW_NOTIFICATION_KEY_PREFIX}${postId}`
}

export function salonReviewNotificationLink(postId: string) {
  return `/admin/salon?postId=${encodeURIComponent(postId)}`
}

function safeSalonCategoryLabel(category: string) {
  const knownLabels: Record<string, string> = {
    CONCERT: '演唱会记录',
    MOBILE_WALLPAPER: '手机壁纸',
    DESKTOP_WALLPAPER: '电脑壁纸',
    TIME_TRAVEL: '时光倒流二十年',
  }
  const label = salonCategoryLabel(category)
  return knownLabels[category] || (label !== category ? label : '沙龙作品')
}

function safeTitle(title: string | null | undefined) {
  const trimmed = title?.trim()
  return trimmed ? `《${trimmed}》` : '无标题作品'
}

export function buildSalonReviewNotificationContent(input: {
  nickname: string | null | undefined
  category: string
  title?: string | null
}) {
  const nickname = input.nickname?.trim() || '有用户'
  const category = safeSalonCategoryLabel(input.category)
  return `${nickname} 投稿了「${category}」${safeTitle(input.title)}，请审核`
}

export function salonReviewNotificationWhere(postId: string): Prisma.NotificationWhereInput {
  return {
    type: 'REVIEW',
    key: salonReviewNotificationKey(postId),
    link: salonReviewNotificationLink(postId),
  }
}

export async function getSalonReviewAdminIds(db: NotificationDb = prisma) {
  const admins = await db.user.findMany({
    where: {
      role: { in: ['ADMIN', 'SUPER_ADMIN'] },
      status: 'ACTIVE',
      isDeleted: false,
      OR: [
        { role: 'SUPER_ADMIN' },
        { AdminPermission: { some: { permissionKey: SALON_REVIEW_PERMISSION, enabled: true } } },
      ],
    },
    select: { id: true },
  })
  return admins.map((admin) => admin.id)
}

export async function createSalonReviewNotifications(input: {
  postId: string
  authorId: string
  nickname: string | null | undefined
  category: string
  title?: string | null
}, db: NotificationDb = prisma) {
  const recipientIds = await getSalonReviewAdminIds(db)
  if (!recipientIds.length) return recipientIds

  await createManyNotificationsWithDb(db, {
    data: recipientIds.map((recipientId) => ({
      recipientId,
      actorId: input.authorId,
      type: 'REVIEW' as const,
      title: SALON_REVIEW_NOTIFICATION_TITLE,
      content: buildSalonReviewNotificationContent(input),
      link: salonReviewNotificationLink(input.postId),
      key: salonReviewNotificationKey(input.postId),
    })),
    skipDuplicates: true,
  }, {
    operation: 'salon.admin-review-notification',
    userId: input.authorId,
  })

  return recipientIds
}

export async function completeSalonReviewNotifications(input: {
  postId: string
  status: SalonReviewStatus
  title?: string | null
  completedAt: Date
}, db: NotificationDb = prisma) {
  const completedTitle = input.status === 'APPROVED' ? '沙龙投稿已通过审核' : '沙龙投稿已拒绝'
  const completedContent = input.status === 'APPROVED'
    ? `${safeTitle(input.title)}已通过审核。`
    : `${safeTitle(input.title)}未通过审核。`
  const rows = await db.notification.findMany({
    where: salonReviewNotificationWhere(input.postId),
    select: { recipientId: true },
  })
  if (!rows.length) return []

  await db.notification.updateMany({
    where: salonReviewNotificationWhere(input.postId),
    data: {
      title: completedTitle,
      content: completedContent,
      completedAt: input.completedAt,
      isRead: true,
      readAt: input.completedAt,
    },
  })
  return Array.from(new Set(rows.map((row) => row.recipientId)))
}
