import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireRequestUser } from '@/lib/security'
import {
  buildCantoneseProgressResponse,
  loadCantoneseProgressContext,
  transitionCantoneseProgress,
  type CantoneseProgressAction,
} from '@/lib/cantonese-progress'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }
const ACTIONS = new Set<CantoneseProgressAction>(['START', 'TEACHING_COMPLETE', 'QUESTIONS_COMPLETE', 'COMPLETE'])

type Context = { params: Promise<{ lessonId: string }> }

class ProgressRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

function errorResponse(code: string, status: number) {
  return NextResponse.json({ ok: false, code }, { status, headers: NO_STORE })
}

export async function POST(request: Request, { params }: Context) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response

  const { lessonId } = await params
  if (!/^lesson-\d{2,3}$/.test(lessonId)) return errorResponse('LESSON_NOT_RELEASED', 404)

  const body = await request.json().catch(() => null) as { action?: unknown } | null
  if (!body || typeof body.action !== 'string' || !ACTIONS.has(body.action as CantoneseProgressAction)) {
    return errorResponse('INVALID_ACTION', 400)
  }
  const action = body.action as CantoneseProgressAction

  try {
    const progress = await prisma.$transaction(async (tx) => {
      const context = await loadCantoneseProgressContext(guard.user.id, tx)
      const definition = context.definitions.find((item) => item.lessonId === lessonId)
      if (!definition) throw new ProgressRequestError('LESSON_NOT_RELEASED', 404)

      const current = context.progressRows.find((item) => item.lessonId === lessonId)
      const readiness = context.readiness.find((item) => item.lessonId === lessonId)
      const snapshot = buildCantoneseProgressResponse(context)
      const lessonState = snapshot.lessons.find((item) => item.lessonId === lessonId)?.state
      if (lessonState === 'COMPLETED') return snapshot
      if (lessonState === 'NOT_RELEASED') throw new ProgressRequestError('LESSON_NOT_RELEASED', 404)
      if (lessonState === 'LOCKED') throw new ProgressRequestError('LESSON_LOCKED', 409)

      const now = new Date()
      const transition = transitionCantoneseProgress({
        current,
        action,
        now,
        // Only the question set actually released by the course API is a
        // completion milestone. Pending/blocked candidate questions must not
        // make an otherwise usable lesson impossible to complete.
        questionsRequired: Boolean(readiness && readiness.assessmentAvailability === 'READY' && readiness.approvedQuestionCount > 0),
        questionsReady: readiness?.assessmentAvailability === 'READY',
      })
      if (!transition.ok) throw new ProgressRequestError(transition.code, 409)

      const patchEntries = Object.entries(transition.patch) as [
        'startedAt' | 'teachingCompletedAt' | 'questionsCompletedAt' | 'completedAt',
        Date,
      ][]
      for (const [field, value] of patchEntries) {
        await tx.cantoneseLessonProgress.upsert({
          where: { userId_lessonId: { userId: guard.user.id, lessonId } },
          create: { userId: guard.user.id, lessonId },
          update: {},
        })
        await tx.cantoneseLessonProgress.updateMany({
          where: { userId: guard.user.id, lessonId, [field]: null },
          data: { [field]: value },
        })
      }

      const progressRows = patchEntries.length
        ? await tx.cantoneseLessonProgress.findMany({
          where: { userId: guard.user.id },
          select: { lessonId: true, startedAt: true, teachingCompletedAt: true, questionsCompletedAt: true, completedAt: true },
        })
        : context.progressRows
      return buildCantoneseProgressResponse({ ...context, progressRows })
    })
    return NextResponse.json(progress, { headers: NO_STORE })
  } catch (error) {
    if (error instanceof ProgressRequestError) return errorResponse(error.code, error.status)
    return errorResponse('PROGRESS_UNAVAILABLE', 503)
  }
}
