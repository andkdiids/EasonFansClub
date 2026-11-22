import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getMemoirAvailability } from '@/lib/annual-memoir-policy'

export function visibleMemoirActivities(now: Date, activityCenter = false): Prisma.ActivityWhereInput {
  return { OR: [
    { annualMemoirConfig: { is: null } },
    { status: 'PUBLISHED', type: 'TOPIC_ACTIVITY', coverUrl: { not: null, notIn: [''] }, annualMemoirConfig: { is: {
      enabled: true, previewAt: { lte: now }, reservationPoints: { gte: 0 },
      annualBadgeId: { not: null }, ...(activityCenter ? { showInActivityCenter: true } : {}),
    } } },
  ] }
}

export async function readMemoirEntry(activityId: string | undefined, userId?: string) {
  const config = await prisma.annualMemoirConfig.findFirst({
    where: activityId ? { activityId } : { year: 2026 },
    include: { activity: { select: { id: true, type: true, status: true, title: true, coverUrl: true, isFeatured: true } } },
  })
  if (!config) return null
  const [reservation, snapshot] = userId ? await Promise.all([
    prisma.annualMemoirReservation.findUnique({ where: { activityId_userId: { activityId: config.activityId, userId } } }),
    prisma.annualMemoirSnapshot.findUnique({ where: { userId_year: { userId, year: config.year } }, select: { activityId: true } }),
  ]) : [null, null]
  const hasSnapshot = snapshot?.activityId === config.activityId
  const now = new Date()
  const state = getMemoirAvailability({ schedule: config, now, hasSnapshot,
    configuredAndPublished: config.enabled && config.activity.status === 'PUBLISHED' &&
      config.activity.type === 'TOPIC_ACTIVITY' && !!config.activity.coverUrl &&
      !!config.annualBadgeId && config.reservationPoints >= 0,
  })
  return { config, reservation, hasSnapshot, state, ended: now >= config.endsAt, serverNow: now.getTime() }
}
