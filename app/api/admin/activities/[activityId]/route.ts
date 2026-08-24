import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { activitySelect, serializeActivityRow, type ActivityRow } from '@/lib/activity-data'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { checkBannedWords, CONTENT_CONTAINS_BANNED_WORD, BANNED_WORD_MESSAGE } from '@/lib/content-moderation'
import { normalizeActivityInput, type ActivityEditableValues } from '@/lib/activity-validation'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

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
    startsAt: activity.startsAt,
    endsAt: activity.endsAt,
    registrationStartAt: activity.registrationStartAt,
    registrationEndAt: activity.registrationEndAt,
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
    'startsAt', 'endsAt', 'registrationStartAt', 'registrationEndAt', 'signupLimit', 'organizer', 'contactInfo', 'isFeatured', 'isPinned', 'sortOrder',
  ]
  return keys.filter((key) => {
    const left = before[key]
    const right = after[key]
    if (left instanceof Date || right instanceof Date) return (left instanceof Date ? left.getTime() : left) !== (right instanceof Date ? right.getTime() : right)
    return left !== right
  }) as string[]
}

function moderationText(value: ActivityEditableValues) {
  return [value.title, value.subtitle, value.description, value.locationName, value.locationAddress, value.organizer, value.contactInfo].filter(Boolean).join('\n')
}

async function getActivity(activityId: string) {
  return prisma.activity.findUnique({ where: { id: activityId }, select: activitySelect })
}

export async function GET(_request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const activity = await getActivity(activityId)
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  return NextResponse.json({ activity: serializeActivityRow(activity) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ activityId: string }> }) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  if (!activityIdPattern.test(activityId)) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const current = await getActivity(activityId)
  if (!current) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  const body = await request.json().catch(() => null)
  const normalized = normalizeActivityInput(body, editableActivity(current))
  if (!normalized.valid) return NextResponse.json({ message: normalized.message }, { status: 400 })
  if ((await checkBannedWords(moderationText(normalized.value))).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
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
    const activity = await prisma.$transaction(async (tx) => {
      const updated = await tx.activity.update({
        where: { id: activityId },
        data: {
          ...normalized.value,
          publishedAt,
          updatedById: guard.user.id,
        },
        select: activitySelect,
      })
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'CREATE_ACTIVITY',
        operationType,
        targetType: 'ACTIVITY',
        targetId: updated.id,
        targetTitle: updated.title,
        metadata: { activityId: updated.id, changedFields: fields, fromStatus: current.status, toStatus: updated.status } as Prisma.InputJsonValue,
      })
      return updated
    })
    revalidatePath('/activities')
    revalidatePath(`/activities/${activityId}`)
    revalidatePath('/')
    return NextResponse.json({ activity: serializeActivityRow(activity) })
  } catch (error) {
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
      _count: { select: { ActivityRegistration: true, ActivityFavorite: true, Lottery: true } },
    },
  })
  if (!activity) return NextResponse.json({ message: '活动不存在' }, { status: 404 })
  if (activity.status !== 'DRAFT' || activity._count.ActivityRegistration > 0 || activity._count.ActivityFavorite > 0 || activity._count.Lottery > 0) {
    return NextResponse.json({ message: '已发布、已取消或存在关联数据的活动不能删除，请使用“取消活动”保留历史记录' }, { status: 409 })
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
