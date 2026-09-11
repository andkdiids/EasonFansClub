import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { createAdminActionAudit, adminAuditOperations } from '@/lib/admin-audit'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'
import { safeNotificationWrite } from '@/lib/notification-transaction'
import { createSalonReviewNotifications, salonReviewNotificationKey } from '@/lib/salon-review-notifications'
import { getSalonPostForViewer, normalizeSalonConcertSelection, parseSalonCategory, SALON_CATEGORY_CONFIG, type SalonCategoryValue } from '@/lib/salon'
import { prisma } from '@/lib/prisma'
import { emitRealtimeMany } from '@/lib/realtime'
import { requireUser, sanitizeText } from '@/lib/security'
import { completeTask, grantGrowthReward } from '@/lib/growth-tasks/service'

type RouteContext = { params: Promise<{ postId: string }> }

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: RouteContext) {
  const { postId } = await context.params
  const user = await getCurrentUser()
  const canModerate = Boolean(user && await hasAdminPermission(user, 'post_manage').catch(() => false))
  const post = await getSalonPostForViewer(postId, user?.id, canModerate)
  if (!post) return NextResponse.json({ ok: false, message: '作品不存在或当前不可查看' }, { status: 404 })
  return NextResponse.json({ ok: true, post }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const post = await prisma.salonPost.findUnique({ where: { id: postId }, select: { id: true, userId: true } })
  if (!post) return NextResponse.json({ ok: false, message: '作品不存在或已经删除' }, { status: 404 })
  const canModerate = await hasAdminPermission(guard.user, 'post_manage')
  if (!canModerate && post.userId !== guard.user.id) return NextResponse.json({ ok: false, message: '只能删除自己的沙龙作品' }, { status: 403 })

  await prisma.salonPost.delete({ where: { id: postId } })
  revalidatePath('/salon')
  revalidatePath('/salon/mine')
  revalidatePath(`/salon/${postId}`)
  return NextResponse.json({ ok: true, message: '沙龙作品已删除' })
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  const { postId } = await context.params
  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ ok: false, message: '请求内容无效' }, { status: 400 })

  const current = await prisma.salonPost.findUnique({
    where: { id: postId },
    select: { id: true, userId: true, category: true, concertId: true, title: true, content: true, status: true, approvedAt: true, updatedAt: true },
  })
  if (!current) return NextResponse.json({ ok: false, message: '作品不存在' }, { status: 404 })
  const canModerate = await hasAdminPermission(guard.user, 'post_manage').catch(() => false)
  const isOwner = current.userId === guard.user.id
  if (!isOwner && !canModerate) return NextResponse.json({ ok: false, message: '没有修改这篇沙龙作品的权限' }, { status: 403 })

  const baseUpdatedAtValue = body.baseUpdatedAt
  const baseUpdatedAt = baseUpdatedAtValue === undefined || baseUpdatedAtValue === null || baseUpdatedAtValue === ''
    ? null
    : typeof baseUpdatedAtValue === 'string' ? new Date(baseUpdatedAtValue) : null
  if (baseUpdatedAtValue !== undefined && baseUpdatedAtValue !== null && baseUpdatedAtValue !== '' && (!baseUpdatedAt || Number.isNaN(baseUpdatedAt.getTime()))) {
    return NextResponse.json({ ok: false, message: '编辑版本标识无效，请刷新后重试' }, { status: 400 })
  }

  let requestedCategory: SalonCategoryValue | undefined
  if (Object.prototype.hasOwnProperty.call(body, 'category')) {
    const category = parseSalonCategory(body.category)
    if (!category) return NextResponse.json({ ok: false, message: '投稿分类无效' }, { status: 400 })
    requestedCategory = category
  }
  const hasAssociationInput = ['tourId', 'sessionId', 'concertId'].some((key) => Object.prototype.hasOwnProperty.call(body, key))
  const selection = normalizeSalonConcertSelection({
    tourId: sanitizeText(body.tourId, 191),
    sessionId: sanitizeText(body.sessionId, 191),
    concertId: sanitizeText(body.concertId, 191),
  })
  if (selection.hasConflict) return NextResponse.json({ ok: false, message: '演唱会和场次选择不一致，请重新选择' }, { status: 400 })
  const effectiveCategory = requestedCategory || parseSalonCategory(current.category)
  const categoryConfig = effectiveCategory ? SALON_CATEGORY_CONFIG[effectiveCategory] : null
  if (!categoryConfig) return NextResponse.json({ ok: false, message: '投稿分类无效' }, { status: 400 })
  if (!categoryConfig.allowsConcert && (selection.tourId || selection.sessionId)) return NextResponse.json({ ok: false, message: '该投稿分类不支持关联演唱会' }, { status: 400 })
  if (body.sessionId && !selection.tourId) return NextResponse.json({ ok: false, message: '请选择对应的演唱会' }, { status: 400 })

  let selectedConcertId: string | null = selection.sessionId
  if (selection.sessionId) {
    const concert = await prisma.musicConcert.findFirst({
      where: {
        id: selection.sessionId,
        ...(selection.tourId ? { tourId: selection.tourId } : {}),
        status: 'PUBLISHED',
        MusicTour: { status: 'PUBLISHED' },
      },
      select: { id: true },
    })
    if (!concert) return NextResponse.json({ ok: false, message: '演唱会场次不存在、未公开或不属于所选演唱会' }, { status: 400 })
    selectedConcertId = concert.id
  } else if (selection.tourId) {
    const tour = await prisma.musicTour.findFirst({ where: { id: selection.tourId, status: 'PUBLISHED' }, select: { id: true } })
    if (!tour) return NextResponse.json({ ok: false, message: '演唱会不存在或暂未公开' }, { status: 400 })
  } else if (!hasAssociationInput) {
    selectedConcertId = current.concertId
  }
  if (categoryConfig.requiresConcert && !selectedConcertId) return NextResponse.json({ ok: false, message: '演唱会记录必须关联演唱会场次' }, { status: 400 })
  const nextCategory = requestedCategory || current.category
  const nextConcertId = requestedCategory && !categoryConfig.allowsConcert
    ? null
    : hasAssociationInput ? selectedConcertId : current.concertId
  const nextTitle = Object.prototype.hasOwnProperty.call(body, 'title') ? sanitizeText(body.title, 200) || null : current.title
  const nextContent = Object.prototype.hasOwnProperty.call(body, 'content') ? sanitizeText(body.content, 5000) || null : current.content
  const changedFields = [
    nextCategory !== current.category ? 'category' : null,
    nextConcertId !== current.concertId ? 'concertId' : null,
    nextTitle !== current.title ? 'title' : null,
    nextContent !== current.content ? 'content' : null,
  ].filter((field): field is string => Boolean(field))
  if (!changedFields.length) return NextResponse.json({ ok: false, message: '没有需要更新的内容' }, { status: 400 })

  const isAdminEdit = canModerate
  const reviewSubmittedAt = new Date()
  let updated: { id: string; status: string; updatedAt: Date } | null = null
  try {
    updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM \`SalonPost\` WHERE id = ${postId} FOR UPDATE`
      const locked = await tx.salonPost.findUnique({
        where: { id: postId },
        select: { id: true, userId: true, category: true, concertId: true, title: true, content: true, status: true, approvedAt: true, updatedAt: true },
      })
      if (!locked) throw new Error('SALON_POST_NOT_FOUND')
      if (baseUpdatedAt && locked.updatedAt.getTime() !== baseUpdatedAt.getTime()) throw new Error('SALON_EDIT_CONFLICT')

      const data: Prisma.SalonPostUncheckedUpdateInput = {
        category: nextCategory,
        concertId: nextConcertId,
        title: nextTitle,
        content: nextContent,
        ...(isAdminEdit
          ? { status: 'APPROVED' as const, approvedAt: reviewSubmittedAt, approvedById: guard.user!.id, rejectReason: null }
          : { status: 'PENDING' as const, approvedAt: null, approvedById: null, rejectReason: null }),
      }
      const saved = await tx.salonPost.update({ where: { id: postId }, data, select: { id: true, status: true, updatedAt: true } })

      if (isAdminEdit) {
        if (locked.status !== 'APPROVED') {
          await grantGrowthReward(tx, {
            userId: locked.userId,
            taskCode: 'SALON_APPROVED',
            sourceEventId: locked.id,
            reason: '管理员编辑沙龙作品并直接通过',
          })
          await completeTask(tx, { userId: locked.userId, taskCode: 'FIRST_SALON', periodKey: 'ALL', sourceEventId: locked.id })
        }
        await createAdminActionAudit(tx, {
          operatorId: guard.user!.id,
          action: 'UPDATE_SETTING',
          operationType: adminAuditOperations.SALON_POST_ADMIN_EDIT,
          targetType: 'SALON_POST',
          targetId: postId,
          targetTitle: nextTitle,
          targetUserId: locked.userId,
          metadata: {
            salonId: postId,
            adminUserId: guard.user!.id,
            operation: 'ADMIN_EDIT',
            beforeCategory: locked.category,
            afterCategory: nextCategory,
            changedFields,
          } as Prisma.InputJsonValue,
        })
      }
      return saved
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'SALON_EDIT_CONFLICT') {
      return NextResponse.json({ ok: false, code: 'SALON_EDIT_CONFLICT', message: '内容在编辑期间已被修改，请刷新后重新检查' }, { status: 409 })
    }
    if (error instanceof Error && error.message === 'SALON_POST_NOT_FOUND') return NextResponse.json({ ok: false, message: '作品不存在或已经删除' }, { status: 404 })
    console.error('[salon.posts.edit]', { postId, userId: guard.user.id, isAdminEdit, error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ ok: false, message: '作品更新失败，请稍后重试' }, { status: 500 })
  }

  if (!updated) return NextResponse.json({ ok: false, message: '作品更新失败，请稍后重试' }, { status: 500 })
  if (!isAdminEdit) {
    const adminRecipientIds = await safeNotificationWrite(
      () => createSalonReviewNotifications({
        postId,
        authorId: guard.user!.id,
        nickname: guard.user!.nickname,
        category: nextCategory,
        title: nextTitle,
        reviewKind: 'EDIT',
        notificationKey: `${salonReviewNotificationKey(postId, 'EDIT')}:${updated.updatedAt.getTime()}`,
      }),
      {
        operation: 'salon.edit.admin-review-notification.failed',
        userId: guard.user.id,
        targetId: postId,
        notificationType: 'REVIEW',
      },
    )
    if (adminRecipientIds?.length) {
      await safeNotificationWrite(
        async () => { emitRealtimeMany(adminRecipientIds, 'notification') },
        {
          operation: 'salon.edit.admin-review-notification.realtime',
          userId: guard.user.id,
          targetId: postId,
          notificationType: 'REVIEW',
        },
      )
    }
  }
  revalidatePath('/salon')
  revalidatePath('/salon/mine')
  revalidatePath(`/salon/${postId}`)
  revalidatePath('/admin/review')
  return NextResponse.json({
    ok: true,
    postId,
    status: updated.status,
    updatedAt: updated.updatedAt.toISOString(),
    message: isAdminEdit ? '沙龙作品已更新并直接通过' : '修改已保存，正在等待审核。',
  })
}
