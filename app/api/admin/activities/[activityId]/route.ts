import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { activitySelect, serializeActivityRow, type ActivityRow } from '@/lib/activity-data'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { checkBannedWords, CONTENT_CONTAINS_BANNED_WORD, BANNED_WORD_MESSAGE } from '@/lib/content-moderation'
import { normalizeActivityInput, type ActivityEditableValues } from '@/lib/activity-validation'
import { ActivityConfigurationError, ActivityRegistrationError, cancelActivityInTransaction, getActivityRegistrationQuestions, syncActivityRegistrationQuestions, syncActivityReward } from '@/lib/activity-registration'
import { ActivityMaterialConfigurationError, syncActivityLinkedMaterial } from '@/lib/activity-material'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { grantEligibleActivityBadges } from '@/lib/activity-badge-rewards'

export const dynamic = 'force-dynamic'

const activityIdPattern = /^[A-Za-z0-9_-]{8,128}$/

function editableActivity(activity: ActivityRow): ActivityEditableValues {
  return {
    title: activity.title,
    subtitle: activity.subtitle,
    description: activity.description,
    type: activity.type,
    status: activity.status,
    coverUrl: activity.coverUrl,
    bannerUrl: activity.bannerUrl,
    locationName: activity.locationName,
    locationAddress: activity.locationAddress,
    onlineUrl: activity.onlineUrl,
    registrationFee: activity.registrationFee,
    feeDescription: activity.feeDescription,
    linkedMaterialId: activity.linkedMaterial?.id || null,
    startsAt: activity.startsAt,
    endsAt: activity.endsAt,
    registrationStartAt: activity.registrationStartAt,
    registrationEndAt: activity.registrationEndAt,
    verificationMode: activity.verificationMode,
    signupLimit: activity.signupLimit,
    organizer: activity.organizer,
    contactInfo: activity.contactInfo,
    isFeatured: activity.isFeatured,
    isPinned: activity.isPinned,
    sortOrder: activity.sortOrder,
  }
}

function changedFields(before: ActivityEditableValues, after: ActivityEditableValues) {
  const keys: Array<keyof ActivityEditableValues> = [
    'title', 'subtitle', 'description', 'type', 'status', 'coverUrl', 'bannerUrl', 'locationName', 'locationAddress', 'onlineUrl',
    'startsAt', 'endsAt', 'registrationStartAt', 'registrationEndAt', 'verificationMode', 'signupLimit', 'registrationFee', 'feeDescription', 'linkedMaterialId', 'organizer', 'contactInfo', 'isFeatured', 'isPinned', 'sortOrder',
  ]
  return keys.filter((key) => {
    const left = before[key]
    const right = after[key]
    if (left instanceof Date || right instanceof Date) return (left instanceof Date ? left.getTime() : left) !== (right instanceof Date ? right.getTime() : right)
    return left !== right
  }) as string[]
}

function moderationText(value: ActivityEditableValues) {
  return [value.title, value.subtitle, value.description, value.feeDescription, value.locationName, value.locationAddress, value.organizer, value.contactInfo].filter(Boolean).join('\n')
}

async function getActivity(activityId: string) {
  return prisma.activity.findUnique({ where: { id: activityId }, select: activitySelect })
}

async function assertLotterySchedulesFitActivityEnd(tx: Prisma.TransactionClient, activityId: string, activityEndAt: Date | null) {
  const conflictingLottery = await tx.lottery.findFirst({
    where: {
      activityId,
      status: { in: ['DRAFT', 'SCHEDULED'] },
      drawAt: activityEndAt ? { gte: activityEndAt } : { not: null },
    },
    select: { id: true },
  })
  if (conflictingLottery) throw new ActivityConfigurationError('活动结束时间必须晚于已有抽奖开奖时间，请先调整抽奖时间。')
}

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const activity = await getActivity(activityId)
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const [questions, reward] = await Promise.all([
    getActivityRegistrationQuestions(prisma, activityId),
    prisma.activityReward.findUnique({ where: { activityId_type: { activityId, type: 'BADGE' } }, select: { badgeId: true, enabled: true, badgeGrantAt: true, Badge: { select: { id: true, name: true, code: true } } } }),
  ])
  return NextResponse.json({ activity: serializeActivityRow(activity), registrationQuestions: questions, activityReward: reward ? { badgeId: reward.badgeId, enabled: reward.enabled, badgeGrantAt: reward.badgeGrantAt?.toISOString() || null, badge: reward.Badge } : null }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const invalidOrigin = rejectInvalidRequestOrigin(request)
  if (invalidOrigin) return invalidOrigin
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const current = await getActivity(activityId)
  if (!current) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const body = await request.json().catch(() => null)
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const normalized = normalizeActivityInput(body, editableActivity(current))
  if (!normalized.valid) return NextResponse.json({ message: normalized.message }, { status: 400 })
  if (current.status === 'CANCELLED' && normalized.value.status !== 'CANCELLED') {
    return NextResponse.json({ code: 'ACTIVITY_CANCELLED', message: '已取消的活动不能恢复或重新发布' }, { status: 409 })
  }
  if ((await checkBannedWords(moderationText(normalized.value))).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }

  if (normalized.value.verificationMode === 'NONE' && !Object.prototype.hasOwnProperty.call(input, 'activityReward')) {
    const existingReward = await prisma.activityReward.findUnique({ where: { activityId_type: { activityId, type: 'BADGE' } }, select: { id: true } })
    if (existingReward) return NextResponse.json({ message: '该活动已配置隐藏奖励，请先清除奖励或选择核销方式' }, { status: 400 })
  }

  const fields = changedFields(editableActivity(current), normalized.value)
  const now = new Date()
  const publishedAt = normalized.value.status === 'PUBLISHED'
    ? (current.status === 'PUBLISHED' ? current.publishedAt || now : now)
    : null
  const operationType = current.status !== normalized.value.status
    ? normalized.value.status === 'PUBLISHED'
      ? adminAuditOperations.ACTIVITY_PUBLISH
      : normalized.value.status === 'CANCELLED'
        ? adminAuditOperations.ACTIVITY_CANCEL
        : adminAuditOperations.ACTIVITY_UNPUBLISH
    : adminAuditOperations.ACTIVITY_UPDATE

  try {
    const transactionResult = await prisma.$transaction(async (tx) => {
      const { linkedMaterialId, ...activityData } = normalized.value
      await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Activity\` WHERE \`id\` = ${activityId} FOR UPDATE`
      const lockedCurrent = await tx.activity.findUnique({ where: { id: activityId }, select: { status: true } })
      if (!lockedCurrent) throw new ActivityRegistrationError('ACTIVITY_NOT_FOUND', '活动不存在', 404)
      if (lockedCurrent.status === 'CANCELLED' && normalized.value.status !== 'CANCELLED') {
        throw new ActivityRegistrationError('ACTIVITY_CANCELLED', '已取消的活动不能恢复或重新发布', 409)
      }
      // Cancelling is a terminal business action and must not be blocked by
      // an unrelated legacy lottery schedule that would otherwise prevent a
      // normal activity edit.
      if (normalized.value.status !== 'CANCELLED') await assertLotterySchedulesFitActivityEnd(tx, activityId, normalized.value.endsAt)
      const updated = await tx.activity.update({
        where: { id: activityId },
        data: {
          ...activityData,
          publishedAt,
          updatedById: guard.user.id,
        },
        select: activitySelect,
      })
      if (normalized.value.status !== 'CANCELLED') await syncActivityLinkedMaterial(tx, { activityId, linkedMaterialId, startsAt: updated.startsAt, endsAt: updated.endsAt })
      const cancellation = updated.status === 'CANCELLED'
        ? await cancelActivityInTransaction(tx, { activityId: updated.id, adminId: guard.user.id, now })
        : null
      if (Object.prototype.hasOwnProperty.call(input, 'registrationQuestions')) await syncActivityRegistrationQuestions(tx, activityId, input.registrationQuestions)
      if (Object.prototype.hasOwnProperty.call(input, 'activityReward')) await syncActivityReward(tx, activityId, input.activityReward, normalized.value.verificationMode)
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'CREATE_ACTIVITY',
        operationType,
        targetType: 'ACTIVITY',
        targetId: updated.id,
        targetTitle: updated.title,
        metadata: { activityId: updated.id, changedFields: fields, fromStatus: current.status, toStatus: updated.status, cancellation: cancellation ? { registrationsCancelled: cancellation.registrations.cancelled, refundedCount: cancellation.registrations.refundedCount, refundedAmount: cancellation.registrations.refundedAmount, lotteriesCancelled: cancellation.lotteriesCancelled } : null } as Prisma.InputJsonValue,
      })
      if (Object.prototype.hasOwnProperty.call(input, 'registrationQuestions')) await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'CREATE_ACTIVITY',
        operationType: adminAuditOperations.ACTIVITY_FORM_UPDATE,
        targetType: 'ACTIVITY',
        targetId: updated.id,
        targetTitle: updated.title,
        metadata: { activityId: updated.id, questionCount: Array.isArray(input.registrationQuestions) ? input.registrationQuestions.length : 0 } as Prisma.InputJsonValue,
      })
      if (Object.prototype.hasOwnProperty.call(input, 'activityReward')) await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'CREATE_ACTIVITY',
        operationType: adminAuditOperations.ACTIVITY_REWARD_UPDATE,
        targetType: 'ACTIVITY',
        targetId: updated.id,
        targetTitle: updated.title,
        metadata: { activityId: updated.id, activityReward: input.activityReward as Prisma.InputJsonValue } as Prisma.InputJsonValue,
      })
      return { activity: await tx.activity.findUniqueOrThrow({ where: { id: activityId }, select: activitySelect }), cancellation }
    })
    if (transactionResult.activity.status !== 'CANCELLED') {
      try {
        await grantEligibleActivityBadges({ activityId })
      } catch (error) {
        console.error('[admin.activities.update.badge-reward-compensation]', { activityId, error })
      }
    }
    revalidatePath('/activities')
    revalidatePath(`/activities/${activityId}`)
    revalidatePath('/')
    const cancellation = transactionResult.cancellation ? {
      registrationsCancelled: transactionResult.cancellation.registrations.cancelled,
      refundedCount: transactionResult.cancellation.registrations.refundedCount,
      refundedAmount: transactionResult.cancellation.registrations.refundedAmount,
      lotteriesCancelled: transactionResult.cancellation.lotteriesCancelled,
    } : null
    return NextResponse.json({
      success: true,
      activityId,
      activity: serializeActivityRow(transactionResult.activity),
      cancellation,
      ...(cancellation || {}),
    })
  } catch (error) {
    if (error instanceof ActivityConfigurationError || error instanceof ActivityMaterialConfigurationError) return NextResponse.json({ message: error.message }, { status: 400 })
    if (error instanceof ActivityRegistrationError) return NextResponse.json({ code: error.code, message: error.message }, { status: error.status })
    console.error('[admin.activities.update]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: '保存活动失败，请稍后重试' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      title: true,
      status: true,
      linkedMaterial: { select: { id: true, title: true } },
      _count: { select: { ActivityRegistration: true, ActivityFavorite: true, Lottery: true } },
    },
  })
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  if (activity.status !== 'DRAFT' || activity._count.ActivityRegistration > 0 || activity._count.ActivityFavorite > 0 || activity._count.Lottery > 0 || activity.linkedMaterial) {
    return NextResponse.json({ message: activity.linkedMaterial ? '活动已绑定物料，请先解除绑定后再删除' : '已发布、已取消或存在关联数据的活动不能删除，请使用“取消活动”保留历史记录' }, { status: 409 })
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.activity.delete({ where: { id: activityId } })
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'CREATE_ACTIVITY',
        operationType: adminAuditOperations.ACTIVITY_DELETE,
        targetType: 'ACTIVITY',
        targetId: activityId,
        targetTitle: activity.title,
        metadata: { activityId, status: activity.status } as Prisma.InputJsonValue,
      })
    })
    revalidatePath('/activities')
    revalidatePath('/')
    return NextResponse.json({ ok: true, activityId })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json({ message: '活动仍有其他关联数据，不能删除，请使用“取消活动”' }, { status: 409 })
    }
    console.error('[admin.activities.delete]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: '删除活动失败，请稍后重试' }, { status: 500 })
  }
}
