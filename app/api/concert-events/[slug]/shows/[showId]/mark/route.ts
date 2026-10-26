import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, resolveRequestAuth, unauthenticatedResponse } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; showId: string }> }) {
  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  if (!auth.user) return unauthenticatedResponse('登录后可以标记场次')
  const limited = await enforceApiRateLimit(request, auth.user.id, { endpoint: '/api/concert-events/mark', ip: { limit: 30, windowSeconds: 60 }, user: { limit: 20, windowSeconds: 60 } })
  if (limited) return limited
  const { slug, showId } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ message: '请求内容无效' }, { status: 400 })
  const input = body as Record<string, unknown>
  if (typeof input.wantToGo !== 'boolean' || typeof input.hasTicket !== 'boolean' || (input.isPublic !== undefined && typeof input.isPublic !== 'boolean')) {
    return NextResponse.json({ message: '场次状态格式无效' }, { status: 400 })
  }
  try {
    const event = await prisma.concertEvent.findFirst({ where: { slug, status: { in: ['UPCOMING', 'REGISTRATION', 'WAITING_DRAW', 'SHOWING'] }, allowMarking: true }, select: { id: true } })
    const show = event ? await prisma.concertShow.findFirst({ where: { id: showId, eventId: event.id, status: 'SCHEDULED' }, select: { id: true } }) : null
    if (!event || !show) return NextResponse.json({ message: '当前场次暂不可标记' }, { status: 404 })
    if (!input.wantToGo && !input.hasTicket) {
      await prisma.concertShowMark.deleteMany({ where: { userId: auth.user.id, showId: show.id, eventId: event.id } })
      return NextResponse.json({ mark: null })
    }
    const mark = await prisma.concertShowMark.upsert({
      where: { userId_showId: { userId: auth.user.id, showId: show.id } },
      create: { eventId: event.id, showId: show.id, userId: auth.user.id, wantToGo: input.wantToGo, hasTicket: input.hasTicket, isPublic: input.isPublic === true },
      update: { eventId: event.id, wantToGo: input.wantToGo, hasTicket: input.hasTicket, ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}) },
      select: { showId: true, wantToGo: true, hasTicket: true, isPublic: true },
    })
    return NextResponse.json({ mark }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
  } catch (error) {
    console.error('[concert-events.mark]', { userId: auth.user.id, slug, showId, errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    return NextResponse.json({ message: '保存失败，请稍后重试' }, { status: 503 })
  }
}
