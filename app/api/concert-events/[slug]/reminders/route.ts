import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, resolveRequestAuth, unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  if (!auth.user) return unauthenticatedResponse('登录后可以订阅站内提醒')
  const limited = await enforceApiRateLimit(request, auth.user.id, { endpoint: '/api/concert-events/reminders', ip: { limit: 20, windowSeconds: 60 }, user: { limit: 12, windowSeconds: 60 } })
  if (limited) return limited
  const { slug } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求内容无效' }, { status: 400 })
  const input = body as Record<string, unknown>
  if (!['TIMELINE', 'SHOW'].includes(String(input.targetType)) || typeof input.targetId !== 'string' || !input.targetId || input.targetId.length > 191 || typeof input.enabled !== 'boolean') {
    return NextResponse.json({ message: '提醒设置格式无效' }, { status: 400 })
  }
  try {
    const event = await prisma.concertEvent.findFirst({ where: { slug, status: { in: ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING'] } }, select: { id: true } })
    if (!event) return NextResponse.json({ message: '专题不存在或已结束' }, { status: 404 })
    const isShow = input.targetType === 'SHOW'
    const target = isShow
      ? await prisma.concertShow.findFirst({ where: { id: input.targetId, eventId: event.id, status: 'SCHEDULED' }, select: { id: true } })
      : await prisma.concertTimelineEvent.findFirst({ where: { id: input.targetId, eventId: event.id, enabled: true, notificationEnabled: true }, select: { id: true } })
    if (!target) return NextResponse.json({ message: '该事项暂不支持提醒' }, { status: 404 })
    const where = { userId: auth.user.id, eventId: event.id, targetType: isShow ? 'SHOW' as const : 'TIMELINE' as const, targetId: target.id }
    if (!input.enabled) {
      await prisma.concertReminderSubscription.deleteMany({ where })
      return NextResponse.json({ subscribed: false })
    }
    await prisma.concertReminderSubscription.upsert({
      where: { userId_eventId_targetType_targetId: where },
      create: { ...where, ...(isShow ? { showId: target.id } : { timelineEventId: target.id }) },
      update: {},
    })
    return NextResponse.json({ subscribed: true }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[concert-events.reminder]', { userId: auth.user.id, slug, errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ message: '提醒设置失败，请稍后重试' }, { status: 503 })
  }
}
