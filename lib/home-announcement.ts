import { prisma } from '@/lib/prisma'
import { effectiveSystemNotificationOrder, effectiveSystemNotificationWhere } from '@/lib/system-notifications'

export async function getHomeAnnouncement() {
  return prisma.systemNotification.findFirst({
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
}
