import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { createCreatorReviewNotifications } from '@/lib/studio/review-notifications'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ projectId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { projectId } = await context.params
  let result: {
    kind: 'NOT_FOUND' | 'ALREADY_APPROVED' | 'ALREADY_PENDING' | 'CONCURRENT_CHANGE' | 'SUBMITTED'
    project?: { id: string; title: string; visibility: string; reviewStatus: string; updatedAt: Date }
    adminRecipientIds?: string[]
  }
  try {
    result = await prisma.$transaction(async (tx) => {
      const project = await tx.studioProject.findFirst({
        where: { id: projectId, userId: guard.user.id },
        select: { id: true, userId: true, title: true, visibility: true, reviewStatus: true },
      })
      if (!project) return { kind: 'NOT_FOUND' as const }
      if (project.visibility === 'PUBLIC' && project.reviewStatus === 'APPROVED') return { kind: 'ALREADY_APPROVED' as const, project: { ...project, updatedAt: new Date() } }
      if (project.reviewStatus === 'PENDING') return { kind: 'ALREADY_PENDING' as const, project: { ...project, updatedAt: new Date() } }

      const changed = await tx.studioProject.updateMany({
        where: { id: project.id, userId: guard.user.id, reviewStatus: { not: 'PENDING' } },
        data: { visibility: 'PUBLIC', reviewStatus: 'PENDING' },
      })
      if (!changed.count) return { kind: 'CONCURRENT_CHANGE' as const }

      const submitted = await tx.studioProject.findUnique({
        where: { id: project.id },
        select: { id: true, userId: true, title: true, visibility: true, reviewStatus: true, updatedAt: true },
      })
      if (!submitted) return { kind: 'NOT_FOUND' as const }
      const adminRecipientIds = await createCreatorReviewNotifications({
        projectId: submitted.id,
        authorId: submitted.userId,
        nickname: guard.user.nickname,
        title: submitted.title,
        reviewVersion: submitted.updatedAt.toISOString(),
      }, tx)
      return { kind: 'SUBMITTED' as const, project: submitted, adminRecipientIds }
    }, { timeout: 15_000, maxWait: 5_000 })
  } catch (error) {
    console.error('[CREATOR_REVIEW_NOTIFICATION_FAILED]', {
      submissionId: projectId,
      userId: guard.user.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ ok: false, message: '提交公开审核失败，请稍后重试' }, { status: 500 })
  }

  if (result.kind === 'NOT_FOUND') return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
  if (result.kind === 'CONCURRENT_CHANGE') {
    const latest = await prisma.studioProject.findFirst({ where: { id: projectId, userId: guard.user.id }, select: { visibility: true, reviewStatus: true } })
    if (!latest) return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
    if (latest.visibility === 'PUBLIC' && latest.reviewStatus === 'APPROVED') return NextResponse.json({ ok: true, visibility: latest.visibility, reviewStatus: latest.reviewStatus, message: '作品已经通过公开审核' })
    if (latest.reviewStatus === 'PENDING') return NextResponse.json({ ok: true, visibility: latest.visibility, reviewStatus: latest.reviewStatus, message: '作品正在等待公开审核' })
    return NextResponse.json({ ok: false, message: '项目状态发生变化，请刷新后重试' }, { status: 409 })
  }

  if (result.kind === 'ALREADY_APPROVED' || result.kind === 'ALREADY_PENDING') {
    return NextResponse.json({ ok: true, visibility: result.project?.visibility, reviewStatus: result.project?.reviewStatus, message: result.kind === 'ALREADY_APPROVED' ? '作品已经通过公开审核' : '作品正在等待公开审核' })
  }

  if (result.adminRecipientIds?.length) {
    try {
      emitRealtimeMany(result.adminRecipientIds, 'notification')
    } catch (error) {
      console.error('[CREATOR_REVIEW_NOTIFICATION_REALTIME_FAILED]', {
        submissionId: result.project?.id || projectId,
        recipientAdminCount: result.adminRecipientIds.length,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return NextResponse.json({ ok: true, visibility: result.project?.visibility, reviewStatus: result.project?.reviewStatus, message: '已提交公开审核，审核通过后即可分享' })
}
