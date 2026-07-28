import type { Prisma, SystemNotificationType } from '@prisma/client'

export const systemNotificationTypeLabels: Record<SystemNotificationType, string> = {
  SYSTEM: '系统通知',
  UPDATE: '更新日志',
  ANNOUNCEMENT: '公告',
  ACTIVITY: '活动',
  MAINTENANCE: '维护',
  SECURITY: '安全',
}

export const systemNotificationTypes = Object.keys(systemNotificationTypeLabels) as SystemNotificationType[]

export const systemNotificationSelect = {
  id: true,
  title: true,
  content: true,
  link: true,
  type: true,
  cover: true,
  priority: true,
  popup: true,
  sticky: true,
  publishAt: true,
  expireAt: true,
  published: true,
  buttonText: true,
  buttonUrl: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  User: { select: { uid: true, nickname: true } },
  _count: { select: { SystemNotificationRead: true } },
} satisfies Prisma.SystemNotificationSelect

export type SystemNotificationItem = Prisma.SystemNotificationGetPayload<{ select: typeof systemNotificationSelect }>

export function parseSystemNotificationType(value: unknown): SystemNotificationType {
  const type = String(value || '').toUpperCase()
  return systemNotificationTypes.includes(type as SystemNotificationType) ? (type as SystemNotificationType) : 'SYSTEM'
}

export function validateActionUrl(value: string | null | undefined) {
  const url = String(value || '').trim()
  if (!url) return null
  if (url.startsWith('/')) return url

  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
  } catch {
    return null
  }

  return null
}

export function effectiveSystemNotificationWhere(now = new Date()): Prisma.SystemNotificationWhereInput {
  return {
    published: true,
    publishAt: { lte: now },
    OR: [{ expireAt: null }, { expireAt: { gt: now } }],
  }
}

export const effectiveSystemNotificationOrder = [
  { sticky: 'desc' },
  { priority: 'desc' },
  { publishAt: 'desc' },
  { createdAt: 'desc' },
] satisfies Prisma.SystemNotificationOrderByWithRelationInput[]

export function serializeSystemNotification(item: SystemNotificationItem, totalUsers?: number) {
  const readCount = item._count.SystemNotificationRead
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    link: item.link,
    type: item.type,
    typeLabel: systemNotificationTypeLabels[item.type],
    cover: item.cover,
    priority: item.priority,
    popup: item.popup,
    sticky: item.sticky,
    publishAt: item.publishAt,
    expireAt: item.expireAt,
    published: item.published,
    buttonText: item.buttonText,
    buttonUrl: item.buttonUrl,
    version: item.version,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    createdBy: item.User,
    readCount,
    unreadCount: typeof totalUsers === 'number' ? Math.max(totalUsers - readCount, 0) : undefined,
  }
}
