import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { ConcertAdminInputError, parseConcertEventInput, parseConcertShowInputs, parseConcertTimelineInputs, parseConcertTutorialInputs } from '@/lib/concert-admin-input'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const guard = await requireAdmin('activity_manage', request)
  if (!guard.user) return guard.response
  const { eventId } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求内容无效' }, { status: 400 })
  const input = body as Record<string, unknown>
  try {
    const eventData = parseConcertEventInput(input.event)
    const shows = input.shows === undefined ? null : parseConcertShowInputs(input.shows)
    const timeline = input.timeline === undefined ? null : parseConcertTimelineInputs(input.timeline)
    const tutorials = input.tutorials === undefined ? null : parseConcertTutorialInputs(input.tutorials)
    const event = await prisma.$transaction(async (tx) => {
      const current = await tx.concertEvent.findUnique({ where: { id: eventId }, select: { id: true, slug: true } })
      if (!current) throw new ConcertAdminInputError('专题不存在')
      if (eventData.homepageFeatured) await tx.concertEvent.updateMany({ where: { id: { not: eventId }, homepageFeatured: true }, data: { homepageFeatured: false } })
      const updated = await tx.concertEvent.update({ where: { id: eventId }, data: eventData })
      if (shows) for (const show of shows) {
        const { id, ...data } = show
        if (id) {
          const result = await tx.concertShow.updateMany({ where: { id, eventId }, data: { ...data, songs: data.songs as Prisma.InputJsonValue } })
          if (!result.count) throw new ConcertAdminInputError('场次不属于当前专题或已不存在')
        } else await tx.concertShow.create({ data: { ...data, eventId, songs: data.songs as Prisma.InputJsonValue } })
      }
      if (timeline) for (const item of timeline) {
        const { id, ...data } = item
        if (id) {
          const result = await tx.concertTimelineEvent.updateMany({ where: { id, eventId }, data })
          if (!result.count) throw new ConcertAdminInputError('时间节点不属于当前专题或已不存在')
        } else await tx.concertTimelineEvent.create({ data: { ...data, eventId } })
      }
      if (tutorials) for (const item of tutorials) {
        const { id, ...data } = item
        if (id) {
          const result = await tx.concertTutorial.updateMany({ where: { id, eventId }, data: { ...data, steps: data.steps as Prisma.InputJsonValue } })
          if (!result.count) throw new ConcertAdminInputError('教程不属于当前专题或已不存在')
        } else await tx.concertTutorial.create({ data: { ...data, eventId, steps: data.steps as Prisma.InputJsonValue } })
      }
      await createAdminActionAudit(tx, { operatorId: guard.user!.id, action: 'UPDATE_SETTING', operationType: adminAuditOperations.CONCERT_EVENT_UPDATE, targetType: 'CONCERT_EVENT', targetId: eventId, targetTitle: updated.title, metadata: { slugBefore: current.slug, slugAfter: updated.slug, showRows: shows?.length ?? null, timelineRows: timeline?.length ?? null, tutorialRows: tutorials?.length ?? null } as Prisma.InputJsonValue })
      return tx.concertEvent.findUniqueOrThrow({ where: { id: eventId }, include: { shows: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] }, timeline: { orderBy: [{ date: 'asc' }, { sortOrder: 'asc' }] }, tutorials: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } })
    })
    return NextResponse.json({ event }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    if (error instanceof ConcertAdminInputError) return NextResponse.json({ message: error.message }, { status: 400 })
    if ((error as { code?: string })?.code === 'P2002') return NextResponse.json({ message: '专题路径已被使用' }, { status: 409 })
    console.error('[admin.concert-events.update]', { eventId, errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ message: '保存专题失败，请稍后重试' }, { status: 500 })
  }
}
