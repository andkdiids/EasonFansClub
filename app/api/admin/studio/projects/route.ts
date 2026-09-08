import { NextResponse } from 'next/server'
import { getStudioTool } from '@/lib/studio/tools'
import { prisma } from '@/lib/prisma'
import { emitRealtime } from '@/lib/realtime'
import { createNotification } from '@/lib/notification-write'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { buildStudioReviewNotification, STUDIO_REVIEW_NOTIFICATION_TYPE } from '@/lib/studio/review-notifications'
import { extractStudioReviewPattern, getStudioReviewMetadata } from '@/lib/studio/review-data'
import { canTransitionStudioReviewStatus } from '@/lib/studio/review-transitions'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { grantGrowthReward, reverseGrowthRewardForEvent } from '@/lib/growth-tasks/service'

export const dynamic = 'force-dynamic'

const reviewStatuses = new Set(['PENDING', 'APPROVED', 'REJECTED'])

export async function GET(request: Request) {
  const guard = await requireAdmin('studio_manage')
  if (!guard.user) return guard.response
  const status = new URL(request.url).searchParams.get('status')
  const where = status && reviewStatuses.has(status) ? { reviewStatus: status as 'PENDING' | 'APPROVED' | 'REJECTED' } : undefined
  const [projects, total, pending, published, engagement] = await Promise.all([
    prisma.studioProject.findMany({ where, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, toolSlug: true, title: true, description: true, version: true, data: true, thumbnailUrl: true, visibility: true, reviewStatus: true, createdAt: true, updatedAt: true, User: { select: { uid: true, nickname: true } } } }),
    prisma.studioProject.count(),
    prisma.studioProject.count({ where: { reviewStatus: 'PENDING' } }),
    prisma.studioProject.count({ where: { visibility: 'PUBLIC', reviewStatus: 'APPROVED' } }),
    prisma.studioProject.aggregate({ _sum: { likeCount: true, favoriteCount: true, viewCount: true } }),
  ])
  const rows = projects.map(({ data, ...project }) => {
    const pattern = extractStudioReviewPattern(data)
    return { ...project, pattern, metadata: getStudioReviewMetadata(pattern), createdAt: project.createdAt.toISOString(), updatedAt: project.updatedAt.toISOString(), toolName: getStudioTool(project.toolSlug)?.name || '创作项目' }
  })
  return NextResponse.json({ total, pending, published, engagement: { likes: engagement._sum.likeCount || 0, favorites: engagement._sum.favoriteCount || 0, views: engagement._sum.viewCount || 0 }, projects: rows }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('studio_manage')
  if (!guard.user) return guard.response
  let body: Record<string, unknown>
  try {
    const parsed = await request.json() as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, message: '请求格式不正确' }, { status: 400 })
  }
  const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : ''
  const reviewStatus = typeof body.reviewStatus === 'string' ? body.reviewStatus : ''
  if (!projectId || (reviewStatus !== 'APPROVED' && reviewStatus !== 'REJECTED')) return NextResponse.json({ ok: false, message: '审核状态不正确' }, { status: 400 })
  const project = await prisma.studioProject.findUnique({ where: { id: projectId }, select: { id: true, title: true, userId: true, reviewStatus: true } })
  if (!project) return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
  if (project.reviewStatus === 'REJECTED' && reviewStatus === 'APPROVED') return NextResponse.json({ ok: false, code: 'REVIEW_CONFLICT_REJECT_WINS', message: '该内容已被拒绝，无法再次通过' }, { status: 409 })
  if (project.reviewStatus !== 'PENDING' && !(project.reviewStatus === 'APPROVED' && reviewStatus === 'REJECTED')) return NextResponse.json({ ok: false, code: 'ALREADY_REVIEWED', message: '该作品已被其他管理员处理，请刷新列表' }, { status: 409 })
  const reviewedAt = new Date()
  let updated: { id: string; userId: string; title: string; visibility: 'PRIVATE' | 'PUBLIC' | 'UNLISTED'; reviewStatus: 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED' } | null = null
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Lock and re-read the row inside the transaction. The decision winner
      // must be based on the committed state, not the request's earlier read.
      await tx.$queryRaw`SELECT \`id\` FROM \`StudioProject\` WHERE \`id\` = ${project.id} FOR UPDATE`
      const current = await tx.studioProject.findUnique({ where: { id: project.id }, select: { id: true, userId: true, title: true, visibility: true, reviewStatus: true } })
      if (!current) throw new Error('STUDIO_PROJECT_NOT_FOUND')
      if (current.reviewStatus === reviewStatus) throw new Error('STUDIO_REVIEW_ALREADY_REVIEWED')
      if (current.reviewStatus === 'REJECTED' && reviewStatus === 'APPROVED') throw new Error('STUDIO_REVIEW_CONFLICT_REJECT_WINS')
      if (!canTransitionStudioReviewStatus(current.reviewStatus, reviewStatus)) throw new Error('STUDIO_REVIEW_NOT_ALLOWED')

      const changed = await tx.studioProject.updateMany({
        where: { id: project.id, reviewStatus: current.reviewStatus },
        data: reviewStatus === 'APPROVED'
          ? { visibility: 'PUBLIC', reviewStatus: 'APPROVED' }
          : { visibility: 'PRIVATE', reviewStatus: 'REJECTED' },
      })
      if (!changed.count) throw new Error('STUDIO_PROJECT_ALREADY_REVIEWED')
      if (reviewStatus === 'APPROVED') {
        await grantGrowthReward(tx, {
          userId: current.userId,
          taskCode: 'BEAD_PUBLISHED',
          sourceEventId: current.id,
          reason: '贝多芬与我作品通过审核',
        })
      } else if (current.reviewStatus === 'APPROVED') {
        await reverseGrowthRewardForEvent(tx, {
          userId: current.userId,
          taskCode: 'BEAD_PUBLISHED',
          sourceEventId: current.id,
          reason: '创作作品审核拒绝，撤销通过奖励',
        })
      }
      return tx.studioProject.findUnique({ where: { id: current.id }, select: { id: true, userId: true, title: true, visibility: true, reviewStatus: true } })
    }, { timeout: 15_000, maxWait: 5_000 })
  } catch (error) {
    if (error instanceof Error && error.message === 'STUDIO_REVIEW_CONFLICT_REJECT_WINS') return NextResponse.json({ ok: false, code: 'REVIEW_CONFLICT_REJECT_WINS', message: '该内容已被拒绝，无法再次通过' }, { status: 409 })
    if (error instanceof Error && (error.message === 'STUDIO_REVIEW_ALREADY_REVIEWED' || error.message === 'STUDIO_PROJECT_ALREADY_REVIEWED')) return NextResponse.json({ ok: false, code: 'ALREADY_REVIEWED', message: '该作品已被其他管理员处理，请刷新列表' }, { status: 409 })
    if (error instanceof Error && error.message === 'STUDIO_REVIEW_NOT_ALLOWED') return NextResponse.json({ ok: false, code: 'REVIEW_NOT_ALLOWED', message: '当前作品状态不允许执行该审核操作' }, { status: 409 })
    if (error instanceof Error && error.message === 'STUDIO_PROJECT_NOT_FOUND') return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
    throw error
  }
  if (!updated) return NextResponse.json({ ok: false, message: '项目不存在' }, { status: 404 })
  if (reviewStatus === 'APPROVED' || reviewStatus === 'REJECTED') {
    const notification = await safeNotificationWrite(
      () => createNotification({
        data: buildStudioReviewNotification({
          projectId: updated.id,
          recipientId: updated.userId,
          actorId: guard.user.id,
          title: updated.title,
          status: reviewStatus,
          reviewedAt,
        }),
      }),
      { operation: 'studio-review.result-notification', userId: updated.userId, targetId: updated.id, notificationType: STUDIO_REVIEW_NOTIFICATION_TYPE },
    )
    if (notification) {
      try { emitRealtime(updated.userId, 'notification') } catch { /* notification persistence is authoritative */ }
    }
  }
  return NextResponse.json({ ok: true, project: updated })
}
