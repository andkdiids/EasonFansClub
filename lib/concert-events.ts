import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { publicConcertMarkUserWhere } from '@/lib/concert-privacy'

export const publicConcertEventStatuses = ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING', 'ENDED'] as const

export function parseHttpsRegistrationUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export function asStringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

export async function getPublicConcertEvent(slug: string, viewerId?: string | null) {
  const serverNow = new Date().toISOString()
  const event = await prisma.concertEvent.findFirst({
    where: { slug, status: { in: [...publicConcertEventStatuses] } },
    include: {
      shows: { where: { status: 'SCHEDULED' }, orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] },
      timeline: { where: { enabled: true }, orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] },
      tutorials: { where: { status: 'PUBLISHED' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  })
  if (!event) return null

  const showIds = event.shows.map((show) => show.id)
  const [wantToGoCounts, hasTicketCounts, uniqueWantToGo, uniqueHasTicket, viewerMarks, viewerReminders] = await Promise.all([
    prisma.concertShowMark.groupBy({ by: ['showId'], where: { eventId: event.id, showId: { in: showIds }, isPublic: true, wantToGo: true, user: publicConcertMarkUserWhere }, _count: { _all: true } }),
    prisma.concertShowMark.groupBy({ by: ['showId'], where: { eventId: event.id, showId: { in: showIds }, isPublic: true, hasTicket: true, user: publicConcertMarkUserWhere }, _count: { _all: true } }),
    prisma.concertShowMark.groupBy({ by: ['userId'], where: { eventId: event.id, isPublic: true, wantToGo: true, user: publicConcertMarkUserWhere }, _count: { _all: true } }),
    prisma.concertShowMark.groupBy({ by: ['userId'], where: { eventId: event.id, isPublic: true, hasTicket: true, user: publicConcertMarkUserWhere }, _count: { _all: true } }),
    viewerId ? prisma.concertShowMark.findMany({ where: { eventId: event.id, showId: { in: showIds }, userId: viewerId }, select: { showId: true, wantToGo: true, hasTicket: true, isPublic: true } }) : Promise.resolve([]),
    viewerId ? prisma.concertReminderSubscription.findMany({ where: { eventId: event.id, userId: viewerId }, select: { targetType: true, targetId: true } }) : Promise.resolve([]),
  ])
  const wants = new Map(wantToGoCounts.map((item) => [item.showId, item._count._all]))
  const tickets = new Map(hasTicketCounts.map((item) => [item.showId, item._count._all]))
  const marks = new Map(viewerMarks.map((item) => [item.showId, item]))
  const shows = event.shows.map((show) => ({
    ...show,
    songs: asStringArray(show.songs),
    wantToGoCount: wants.get(show.id) || 0,
    hasTicketCount: tickets.get(show.id) || 0,
    viewerMark: marks.get(show.id) || null,
  }))
  return {
    ...event,
    serverNow,
    shows,
    totalWantToGo: uniqueWantToGo.length,
    totalHasTicket: uniqueHasTicket.length,
    viewerReminderKeys: viewerReminders.map((item) => `${item.targetType}:${item.targetId}`),
  }
}

export function safeEventSlug(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null
}
