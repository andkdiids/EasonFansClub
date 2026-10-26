import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { ConcertAdminInputError, parseConcertEventInput } from '@/lib/concert-admin-input'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const events = await prisma.concertEvent.findMany({ orderBy: [{ updatedAt: 'desc' }], take: 100, include: { shows: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] }, timeline: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] }, tutorials: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } })
  const eventIds = events.map((event) => event.id)
  const [wants, tickets] = await Promise.all([
    prisma.concertShowMark.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds }, wantToGo: true }, _count: { _all: true } }),
    prisma.concertShowMark.groupBy({ by: ['eventId'], where: { eventId: { in: eventIds }, hasTicket: true }, _count: { _all: true } }),
  ])
  const wantCounts = new Map(wants.map((item) => [item.eventId, item._count._all]))
  const ticketCounts = new Map(tickets.map((item) => [item.eventId, item._count._all]))
  const withStats = events.map((event) => ({ ...event, markStats: { wantToGo: wantCounts.get(event.id) || 0, hasTicket: ticketCounts.get(event.id) || 0 } }))
  return NextResponse.json({ events: withStats }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('activity_manage', request)
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  try {
    const data = parseConcertEventInput(body)
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.concertEvent.create({ data })
      if (data.homepageFeatured) await tx.concertEvent.updateMany({ where: { id: { not: created.id }, homepageFeatured: true }, data: { homepageFeatured: false } })
      await createAdminActionAudit(tx, { operatorId: guard.user!.id, action: 'UPDATE_SETTING', operationType: adminAuditOperations.CONCERT_EVENT_CREATE, targetType: 'CONCERT_EVENT', targetId: created.id, targetTitle: created.title, metadata: { slug: created.slug } as Prisma.InputJsonValue })
      return created
    })
    return NextResponse.json({ event }, { status: 201 })
  } catch (error) {
    if (error instanceof ConcertAdminInputError) return NextResponse.json({ message: error.message }, { status: 400 })
    if ((error as { code?: string })?.code === 'P2002') return NextResponse.json({ message: '专题路径已被使用' }, { status: 409 })
    console.error('[admin.concert-events.create]', { errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ message: '创建专题失败，请稍后重试' }, { status: 500 })
  }
}
