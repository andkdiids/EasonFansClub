import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
type Context = { params: Promise<{ lessonId: string }> }

export async function PATCH(request: Request, context: Context) {
  const guard = await requireRequestAdmin(request, 'cantonese_review')
  if (!guard.user) return guard.response
  if (guard.user.role !== 'ADMIN' && guard.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403, headers: NO_STORE })
  }
  const { lessonId } = await context.params
  if (!/^lesson-\d{2,3}$/.test(lessonId)) return NextResponse.json({ ok: false, code: 'INVALID_LESSON' }, { status: 400, headers: NO_STORE })
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || (body.action !== 'approve' && body.action !== 'edit')) {
    return NextResponse.json({ ok: false, code: 'INVALID_ACTION' }, { status: 400, headers: NO_STORE })
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? sanitizeText(body.reason.trim(), 1000) : null
  const edited = body.action === 'edit' ? {
    title: body.title, subtitle: body.subtitle, description: body.description,
    sortOrder: body.sortOrder, prerequisiteLessonId: body.prerequisiteLessonId,
  } : null
  if (edited && (
    typeof edited.title !== 'string' || !edited.title.trim() || edited.title.length > 255
    || (edited.subtitle !== null && edited.subtitle !== undefined && (typeof edited.subtitle !== 'string' || edited.subtitle.length > 255))
    || typeof edited.description !== 'string' || !edited.description.trim() || edited.description.length > 10_000
    || !Number.isSafeInteger(edited.sortOrder) || Number(edited.sortOrder) < 0
    || (edited.prerequisiteLessonId !== null && edited.prerequisiteLessonId !== undefined && (typeof edited.prerequisiteLessonId !== 'string' || !/^lesson-\d{2,3}$/.test(edited.prerequisiteLessonId)))
  )) return NextResponse.json({ ok: false, code: 'INVALID_EDIT' }, { status: 400, headers: NO_STORE })

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.cantoneseCourseDefinition.findUnique({ where: { lessonId } })
    if (!current) return null
    if (body.action === 'approve' && current.status === 'ARCHIVED') return 'ARCHIVED'
    if (body.action === 'approve' && current.prerequisiteLessonId) {
      const prerequisite = await tx.cantoneseCourseDefinition.findUnique({ where: { lessonId: current.prerequisiteLessonId }, select: { status: true } })
      if (prerequisite?.status !== 'APPROVED') return 'PREREQUISITE_NOT_APPROVED'
    }
    if (edited?.prerequisiteLessonId && edited.prerequisiteLessonId === lessonId) return 'INVALID_PREREQUISITE'
    if (edited?.prerequisiteLessonId && !await tx.cantoneseCourseDefinition.findUnique({ where: { lessonId: edited.prerequisiteLessonId as string } })) return 'INVALID_PREREQUISITE'
    const updated = await tx.cantoneseCourseDefinition.update({
      where: { lessonId },
      data: body.action === 'approve'
        ? { status: 'APPROVED', reviewedById: guard.user!.id, reviewedAt: new Date(), reviewNote: reason }
        : {
          title: sanitizeText((edited!.title as string).trim(), 255),
          subtitle: typeof edited!.subtitle === 'string' ? sanitizeText(edited!.subtitle.trim(), 255) : null,
          description: sanitizeText((edited!.description as string).trim(), 10_000),
          sortOrder: edited!.sortOrder as number,
          prerequisiteLessonId: (edited!.prerequisiteLessonId as string | null | undefined) ?? null,
          status: 'CONTENT_REVIEW_REQUIRED', reviewedById: null, reviewedAt: null, reviewNote: null,
        },
    })
    await tx.cantoneseReviewLog.create({ data: {
      reviewerId: guard.user!.id, targetType: 'COURSE', targetId: lessonId,
      action: body.action === 'approve' ? 'APPROVE' : 'EDIT',
      oldStatus: current.status === 'ARCHIVED' ? null : current.status,
      newStatus: body.action === 'approve' ? 'APPROVED' : 'CONTENT_REVIEW_REQUIRED',
      reason,
    } })
    return updated
  })
  if (!result) return NextResponse.json({ ok: false, code: 'NOT_FOUND' }, { status: 404, headers: NO_STORE })
  if (typeof result === 'string') return NextResponse.json({ ok: false, code: result }, { status: 409, headers: NO_STORE })
  return NextResponse.json({ course: result }, { headers: NO_STORE })
}
