import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { isTodayEventSource, isTodayEventType, parseTodayDate } from '@/lib/today'
import { prisma } from '@/lib/prisma'
import { publicImageUrl } from '@/lib/images'
import { requireAdmin, sanitizeText } from '@/lib/security'

type RouteContext = { params: Promise<{ eventId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('today_manage')
  if (!guard.user) return guard.response
  const { eventId } = await context.params
  const body = await request.json().catch(() => null)
  const date = body?.date === undefined ? null : parseTodayDate(body.date)
  if (body?.date !== undefined && !date) return NextResponse.json({ message: '日期格式无效' }, { status: 400 })
  if (body?.type !== undefined && !isTodayEventType(body.type)) return NextResponse.json({ message: '内容类型无效' }, { status: 400 })

  const status = body?.status
  if (status !== undefined && !['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
    return NextResponse.json({ message: '审核状态无效' }, { status: 400 })
  }
  const reviewed = status === 'APPROVED' || status === 'REJECTED'
  const sourceReference = body?.reference !== undefined
    ? body.reference
    : typeof body?.source === 'string' && !isTodayEventSource(body.source)
      ? body.source
      : undefined
  if (body?.source !== undefined && isTodayEventSource(body.source) === false && body?.reference === undefined && typeof body.source !== 'string') {
    return NextResponse.json({ message: '来源格式无效' }, { status: 400 })
  }
  const updated = await prisma.todayEvent.update({
    where: { id: eventId },
    data: {
      ...(date ? { date: date.date, month: date.month, day: date.day } : {}),
      ...(body?.type !== undefined ? { type: body.type } : {}),
      ...(body?.title !== undefined ? { title: sanitizeText(body.title, 160) } : {}),
      ...(body?.content !== undefined ? { content: sanitizeText(body.content, 10_000) } : {}),
      ...(body?.imageUrl !== undefined ? { imageUrl: publicImageUrl(sanitizeText(body.imageUrl, 1000)) } : {}),
      ...(sourceReference !== undefined ? { reference: sanitizeText(sourceReference, 500) || null } : {}),
      ...(isTodayEventSource(body?.source) ? { source: body.source } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(status === 'PENDING' ? { reviewedAt: null, reviewedById: null, rejectionReason: null } : {}),
      ...(reviewed ? { reviewedAt: new Date(), reviewedById: guard.user.id, rejectionReason: status === 'REJECTED' ? sanitizeText(body?.rejectionReason, 1000) || null : null } : {}),
    },
    select: { id: true, status: true, title: true, date: true },
  })
  revalidatePath('/today')
  return NextResponse.json({ event: { ...updated, date: updated.date.toISOString() } })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('today_manage')
  if (!guard.user) return guard.response
  const { eventId } = await context.params
  await prisma.todayEvent.delete({ where: { id: eventId } })
  revalidatePath('/today')
  return NextResponse.json({ ok: true })
}
