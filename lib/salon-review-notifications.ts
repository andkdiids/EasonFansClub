import type { Prisma, PrismaClient } from '@prisma/client'
import { createManyNotificationsWithDb } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { salonCategoryLabel } from '@/lib/salon'
import { buildReviewCenterUrl } from '@/lib/review-center'

type NotificationDb = PrismaClient | Prisma.TransactionClient

export const SALON_REVIEW_NOTIFICATION_TITLE = '新的沙龙投稿待审核'
export const SALON_EDIT_REVIEW_NOTIFICATION_TITLE = '沙龙内容编辑后待审核'
export const SALON_REVIEW_NOTIFICATION_KEY_PREFIX = 'salon-review:'
export const SALON_REVIEW_PERMISSION = 'post_manage' as const

export type SalonReviewStatus = 'APPROVED' | 'REJECTED'
export type SalonReviewKind = 'CREATE' | 'EDIT'

export function salonReviewNotificationKey(postId: string, kind: SalonReviewKind = 'CREATE') {
  return kind === 'EDIT'
    ? `${SALON_REVIEW_NOTIFICATION_KEY_PREFIX}edit:${postId}`
    : `${SALON_REVIEW_NOTIFICATION_KEY_PREFIX}${postId}`
}

export function salonEditReviewNotificationKeyPrefix(postId: string) {
  return `${salonReviewNotificationKey(postId, 'EDIT')}:`
}

export function salonReviewNotificationLink(postId: string) {
  return buildReviewCenterUrl('SALON', postId)
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
  reviewKind?: SalonReviewKind
}) {
  const nickname = input.nickname?.trim() || '有用户'
  const category = safeSalonCategoryLabel(input.category)
  return input.reviewKind === 'EDIT'
    ? `${nickname} 修改了「${category}」${safeTitle(input.title)}，请审核`
    : `${nickname} 投稿了「${category}」${safeTitle(input.title)}，请审核`
}

export function salonReviewNotificationWhere(postId: string, kind: SalonReviewKind = 'CREATE', notificationKey?: string): Prisma.NotificationWhereInput {
  return {
    ...(notificationKey
      ? { key: notificationKey }
      : kind === 'EDIT'
        ? { key: { startsWith: salonEditReviewNotificationKeyPrefix(postId) } }
        : { key: salonReviewNotificationKey(postId, kind) }),
    // The unique business key is stable across the old /admin/salon target
    // and the canonical review-center target. Keep both stored notification
    // types compatible so completing a historical notice also closes it.
    OR: [{ type: 'REVIEW' }, { type: 'ADMIN' }],
  }
}

/**
 * Notification keys are the only durable edit marker available without a
 * SalonPost schema change. Use it instead of updatedAt because likes,
 * comments, and views also update that timestamp.
 */
export async function getSalonEditReviewPostIds(postIds: readonly string[], db: NotificationDb = prisma) {
  const ids = Array.from(new Set(postIds.filter(Boolean)))
  if (!ids.length) return new Set<string>()
  const rows = await db.notification.findMany({
    where: {
      type: 'REVIEW',
      OR: ids.map((postId) => ({ key: { startsWith: salonEditReviewNotificationKeyPrefix(postId) } })),
    },
    select: { key: true },
  })
  const idSet = new Set(ids)
  const prefix = `${SALON_REVIEW_NOTIFICATION_KEY_PREFIX}edit:`
  const result = new Set<string>()
  for (const row of rows) {
    if (!row.key || !row.key.startsWith(prefix)) continue
    const separator = row.key.indexOf(':', prefix.length)
    const postId = separator === -1 ? '' : row.key.slice(prefix.length, separator)
    if (idSet.has(postId)) result.add(postId)
  }
  return result
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
  reviewKind?: SalonReviewKind
  notificationKey?: string
}, db: NotificationDb = prisma) {
  const recipientIds = await getSalonReviewAdminIds(db)
  if (!recipientIds.length) return recipientIds
  const reviewKind = input.reviewKind || 'CREATE'
  const notificationKey = input.notificationKey || salonReviewNotificationKey(input.postId, reviewKind)

  await createManyNotificationsWithDb(db, {
    data: recipientIds.map((recipientId) => ({
      recipientId,
      actorId: input.authorId,
      type: 'REVIEW' as const,
      title: reviewKind === 'EDIT' ? SALON_EDIT_REVIEW_NOTIFICATION_TITLE : SALON_REVIEW_NOTIFICATION_TITLE,
      content: buildSalonReviewNotificationContent({ ...input, reviewKind }),
      link: salonReviewNotificationLink(input.postId),
      key: notificationKey,
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
  reviewKind?: SalonReviewKind
  notificationKey?: string
}, db: NotificationDb = prisma) {
  const reviewKind = input.reviewKind || 'CREATE'
  const completedTitle = reviewKind === 'EDIT'
    ? input.status === 'APPROVED' ? '沙龙内容编辑已通过审核' : '沙龙内容编辑已拒绝'
    : input.status === 'APPROVED' ? '沙龙投稿已通过审核' : '沙龙投稿已拒绝'
  const completedContent = input.status === 'APPROVED'
    ? `${safeTitle(input.title)}已通过审核。`
    : `${safeTitle(input.title)}未通过审核。`
  const rows = await db.notification.findMany({
    where: salonReviewNotificationWhere(input.postId, reviewKind, input.notificationKey),
    select: { recipientId: true },
  })
  if (!rows.length) return []

  await db.notification.updateMany({
    where: salonReviewNotificationWhere(input.postId, reviewKind, input.notificationKey),
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
