import { prisma } from '@/lib/prisma'
import { effectiveSystemNotificationOrder, effectiveSystemNotificationWhere } from '@/lib/system-notifications'
import { normalizeActionUrl } from '@/lib/url-safety'

export async function getHomeAnnouncement() {
  const announcement = await prisma.systemNotification.findFirst({
    where: {
      ...effectiveSystemNotificationWhere(new Date()),
      sticky: true,
    },
    orderBy: effectiveSystemNotificationOrder,
    select: {
      id: true,
      title: true,
      content: true,
      type: true,
      buttonUrl: true,
      link: true,
    },
  })

  return announcement
    ? { ...announcement, link: normalizeActionUrl(announcement.link), buttonUrl: normalizeActionUrl(announcement.buttonUrl) }
    : null
}
