import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { getTodayEventDateKey, isTodayEventSource, isTodayEventType, parseTodayDate } from '@/lib/today'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'
import { parseTodayImageInput } from '@/lib/today-image-url'
import { canTransitionTodayReviewStatus, type TodayReviewStatus } from '@/lib/today-review-transitions'

type RouteContext = { params: Promise<{ eventId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('today_manage')
  if (!guard.user) return guard.response
  const { eventId } = await context.params
  const body = await request.json().catch(() => null)
  const existing = await prisma.todayEvent.findUnique({ where: { id: eventId }, select: { title: true, content: true } })
  if (!existing) return NextResponse.json({ message: '今日内容不存在' }, { status: 404 })
  const nextTitle = body?.title === undefined ? existing.title : sanitizeText(body.title, 160)
  const nextContent = body?.content === undefined ? existing.content : sanitizeText(body.content, 10_000)
  if ((await checkBannedWords(`${nextTitle}\n${nextContent}`)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }
  const date = body?.date === undefined ? null : parseTodayDate(body.date)
  if (body?.date !== undefined && !date) return NextResponse.json({ message: '日期格式无效' }, { status: 400 })
  if (body?.type !== undefined && !isTodayEventType(body.type)) return NextResponse.json({ message: '内容类型无效' }, { status: 400 })

  const status = body?.status as TodayReviewStatus | undefined
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
  const imageInput = parseTodayImageInput(body?.imageUrl, guard.user.id)
  if (!imageInput.valid) return NextResponse.json({ message: '图片无效，请重新选择图片' }, { status: 400 })
  const updateData = {
      ...(date ? { date: date.date, month: date.month, day: date.day } : {}),
      ...(body?.type !== undefined ? { type: body.type } : {}),
      ...(body?.title !== undefined ? { title: nextTitle } : {}),
      ...(body?.content !== undefined ? { content: nextContent } : {}),
      ...(imageInput.provided ? { imageUrl: imageInput.value } : {}),
      ...(sourceReference !== undefined ? { reference: sanitizeText(sourceReference, 500) || null } : {}),
      ...(isTodayEventSource(body?.source) ? { source: body.source } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(status === 'PENDING' ? { reviewedAt: null, reviewedById: null, rejectionReason: null } : {}),
      ...(reviewed ? { reviewedAt: new Date(), reviewedById: guard.user.id, rejectionReason: status === 'REJECTED' ? sanitizeText(body?.rejectionReason, 1000) || null : null } : {}),
    }

  let updated: { id: string; status: string; title: string; date: Date; month: number; day: number }
  try {
    if (reviewed) {
      updated = await prisma.$transaction(async (tx) => {
        // Lock and re-read the same row before deciding. This makes an
        // APPROVE that races with REJECT observe the committed rejection, and
        // makes APPROVED -> REJECTED the deterministic final state.
        await tx.$queryRaw`SELECT \`id\` FROM \`TodayEvent\` WHERE \`id\` = ${eventId} FOR UPDATE`
        const lockedCurrent = await tx.todayEvent.findUnique({
          where: { id: eventId },
          select: { id: true, status: true, title: true, content: true },
        })
        if (!lockedCurrent) throw new Error('TODAY_EVENT_NOT_FOUND')
        if (lockedCurrent.status === status) throw new Error('TODAY_REVIEW_ALREADY_REVIEWED')
        if (lockedCurrent.status === 'REJECTED' && status === 'APPROVED') throw new Error('REVIEW_CONFLICT_REJECT_WINS')
        if (!canTransitionTodayReviewStatus(lockedCurrent.status, status)) throw new Error('TODAY_REVIEW_NOT_ALLOWED')

        const lockedTitle = body?.title === undefined ? lockedCurrent.title : sanitizeText(body.title, 160)
        const lockedContent = body?.content === undefined ? lockedCurrent.content : sanitizeText(body.content, 10_000)
        if ((await checkBannedWords(`${lockedTitle}\n${lockedContent}`)).blocked) throw new Error('CONTENT_CONTAINS_BANNED_WORD')
        const reviewedAt = new Date()
        const changed = await tx.todayEvent.updateMany({
          where: { id: eventId, status: lockedCurrent.status },
          data: {
            ...updateData,
            ...(body?.title !== undefined ? { title: lockedTitle } : {}),
            ...(body?.content !== undefined ? { content: lockedContent } : {}),
            reviewedAt,
          },
        })
        if (changed.count !== 1) throw new Error('TODAY_REVIEW_ALREADY_REVIEWED')
        return tx.todayEvent.findUniqueOrThrow({
          where: { id: eventId },
          select: { id: true, status: true, title: true, date: true, month: true, day: true },
        })
      })
    } else {
      updated = await prisma.todayEvent.update({
        where: { id: eventId },
        data: updateData,
        select: { id: true, status: true, title: true, date: true, month: true, day: true },
      })
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (code === 'TODAY_EVENT_NOT_FOUND') return NextResponse.json({ code: 'TODAY_EVENT_NOT_FOUND', message: '今日内容不存在' }, { status: 404 })
    if (code === 'TODAY_REVIEW_ALREADY_REVIEWED') return NextResponse.json({ code: 'ALREADY_REVIEWED', message: '该内容已被其他管理员处理，请刷新后查看最新状态' }, { status: 409 })
    if (code === 'REVIEW_CONFLICT_REJECT_WINS') return NextResponse.json({ code, message: '该内容已被拒绝，无法再次通过' }, { status: 409 })
    if (code === 'TODAY_REVIEW_NOT_ALLOWED') return NextResponse.json({ code: 'REVIEW_NOT_ALLOWED', message: '当前内容状态不允许执行该审核操作' }, { status: 409 })
    if (code === 'CONTENT_CONTAINS_BANNED_WORD') return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2025') return NextResponse.json({ code: 'TODAY_EVENT_NOT_FOUND', message: '今日内容不存在' }, { status: 404 })
    throw error
  }
  revalidatePath('/today')
  return NextResponse.json({ event: { ...updated, date: getTodayEventDateKey(updated.date, updated.month, updated.day) } })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('today_manage')
  if (!guard.user) return guard.response
  const { eventId } = await context.params
  await prisma.todayEvent.delete({ where: { id: eventId } })
  revalidatePath('/today')
  return NextResponse.json({ ok: true })
}
