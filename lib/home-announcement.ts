import { prisma } from '@/lib/prisma'
import { effectiveSystemNotificationWhere } from '@/lib/system-notifications'

export type HomeUpdate = {
  id: string
  title: string
  content: string
  type: 'UPDATE'
  createdAt: Date
  isPublished: boolean
  priority: number
  publishAt: Date
}

/**
 * The homepage update bar is backed by the existing published changelog
 * records. Keeping this query separate from generic system announcements
 * prevents the home entry from accidentally becoming a forum/post link.
 */
export async function getHomeUpdate(): Promise<HomeUpdate | null> {
  const update = await prisma.systemNotification.findFirst({
    where: {
      ...effectiveSystemNotificationWhere(new Date()),
      type: 'UPDATE',
      isPublished: true,
    },
    orderBy: [{ publishAt: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      content: true,
      type: true,
      createdAt: true,
      isPublished: true,
      priority: true,
      publishAt: true,
    },
  })

  return update
    ? { ...update, type: 'UPDATE' as const }
    : null
}

// Keep the old helper name available to layout preview callers while the
// homepage now explicitly consumes the update-only data source above.
export async function getHomeAnnouncement() {
  return getHomeUpdate()
}
