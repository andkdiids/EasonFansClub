import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { createManyNotificationsWithDb } from '@/lib/notification-write'

let running = false

function getOffsetMinutes(date: Date, timeZone: string) {
  const value = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'shortOffset' }).formatToParts(date).find((part) => part.type === 'timeZoneName')?.value || 'GMT+0'
  const match = value.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/)
  if (!match) return 0
  const minutes = Number(match[2]) * 60 + Number(match[3] || 0)
  return match[1] === '-' ? -minutes : minutes
}

function zonedDateTime(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute))
  return new Date(utcGuess.getTime() - getOffsetMinutes(utcGuess, timeZone) * 60_000)
}

export function getConcertReminderInstant(subscription: {
  targetType: 'SHOW' | 'TIMELINE'
  show: { date: Date; startTime: string | null } | null
  timeline: { date: Date; startsAt: Date | null; endsAt: Date | null } | null
  event: { timezone: string }
}) {
  if (subscription.targetType === 'SHOW' && subscription.show) {
    const date = subscription.show.date.toISOString().slice(0, 10)
    const eventTime = zonedDateTime(date, subscription.show.startTime || '09:00', subscription.event.timezone)
    return new Date(eventTime.getTime() - 24 * 60 * 60 * 1000)
  }
  if (subscription.targetType === 'TIMELINE' && subscription.timeline) {
    const moment = subscription.timeline.startsAt || subscription.timeline.endsAt
    if (moment) return new Date(moment.getTime() - 15 * 60 * 1000)
    const date = subscription.timeline.date.toISOString().slice(0, 10)
    return zonedDateTime(date, '09:00', subscription.event.timezone)
  }
  return null
}

export function getConcertReminderNotificationContent(subscription: {
  targetType: 'SHOW' | 'TIMELINE'
  show: { date: Date; startTime: string | null; albumTitle: string | null } | null
  timeline: { title: string | null } | null
  event: { title: string }
}) {
  if (subscription.targetType === 'SHOW' && subscription.show) {
    const date = subscription.show.date.toISOString().slice(0, 10)
    const time = subscription.show.startTime ? `${subscription.show.startTime} · ` : '演出时间以主办方公告为准 · '
    return `${date} · ${time}${subscription.show.albumTitle || subscription.event.title}`
  }
  return subscription.timeline?.title || subscription.event.title
}

export async function deliverDueConcertReminders(now = new Date()) {
  if (running) return { scanned: 0, delivered: 0 }
  running = true
  try {
    const subscriptions = await prisma.concertReminderSubscription.findMany({
      where: { event: { status: { in: ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING'] } } },
      take: 1000,
      orderBy: { createdAt: 'asc' },
      include: {
        event: { select: { slug: true, title: true, timezone: true } },
        show: { select: { date: true, startTime: true, albumTitle: true } },
        timeline: { select: { date: true, startsAt: true, endsAt: true, title: true } },
      },
    })
    const staleBefore = now.getTime() - 6 * 60 * 60 * 1000
    const due = subscriptions.filter((item) => {
      const at = getConcertReminderInstant(item)
      return at !== null && at.getTime() <= now.getTime() && at.getTime() > staleBefore
    })
    if (!due.length) return { scanned: subscriptions.length, delivered: 0 }
    const notifications = due.map((item) => {
      const scope = `${item.eventId}:${item.targetType}:${item.targetId}`
      const digest = createHash('sha256').update(scope).digest('hex')
      const title = item.targetType === 'SHOW' ? '演唱会场次提醒' : '演唱会时间节点提醒'
      const content = getConcertReminderNotificationContent(item)
      const link = item.targetType === 'SHOW'
        ? `/concerts/${item.event.slug}/shows/${item.targetId}`
        : `/concerts/${item.event.slug}#timeline-${item.targetId}`
      return { recipientId: item.userId, type: 'ACTIVITY' as const, title, content, link, key: `concert-reminder:${digest}` }
    })
    await createManyNotificationsWithDb(prisma, { data: notifications, skipDuplicates: true }, { operation: 'concert-event-reminder' })
    await prisma.concertReminderSubscription.deleteMany({ where: { id: { in: due.map((item) => item.id) } } })
    return { scanned: subscriptions.length, delivered: due.length }
  } finally {
    running = false
  }
}
