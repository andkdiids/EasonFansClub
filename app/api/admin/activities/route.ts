import { validateMemoirAdminInput } from '@/lib/annual-memoir-admin'
import { parseMemoirPlatformPoints, syncMemoirPlatforms } from '@/lib/annual-memoir-platform-admin'
import { rejectInvalidRequestOrigin } from '@/lib/security'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { activityTypeValues, type ActivityTypeValue } from '@/lib/activity'
import { adminAuditOperations, createAdminActionAudit } from '@/lib/admin-audit'
import { checkBannedWords, CONTENT_CONTAINS_BANNED_WORD, BANNED_WORD_MESSAGE } from '@/lib/content-moderation'
import { normalizeActivityInput } from '@/lib/activity-validation'
import { ActivityConfigurationError, syncActivityRegistrationQuestions, syncActivityReward } from '@/lib/activity-registration'
import { ActivityMaterialConfigurationError, syncActivityLinkedMaterial } from '@/lib/activity-material'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { grantEligibleActivityBadges } from '@/lib/activity-badge-rewards'
import { normalizeTopicActivityConfig } from '@/lib/topic-activity-config'
import { syncActivityPostInTransaction } from '@/lib/topic-activity'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response

  const params = new URL(request.url).searchParams
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(10, Number.parseInt(params.get('pageSize') || '20', 10) || 20))
  const query = sanitizeText(params.get('q'), 160)
  const status = sanitizeText(params.get('status'), 30).toUpperCase()
  const type = sanitizeText(params.get('type'), 30).toUpperCase()
  const and: Prisma.ActivityWhereInput[] = []
  if (query) and.push({ OR: [{ title: { contains: query } }, { subtitle: { contains: query } }, { description: { contains: query } }] })
  if (['DRAFT', 'PUBLISHED', 'CANCELLED'].includes(status)) and.push({ status: status as 'DRAFT' | 'PUBLISHED' | 'CANCELLED' })
  if (status === 'ENDED') and.push({ status: 'PUBLISHED', endsAt: { lt: new Date() } })
  if (activityTypeValues.includes(type as ActivityTypeValue)) and.push({ type: type as ActivityTypeValue })
  const where = and.length ? { AND: and } : undefined

  const [total, rows] = await prisma.$transaction([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      orderBy: [{ status: 'asc' }, { isPinned: 'desc' }, { sortOrder: 'asc' }, { startsAt: 'asc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: activitySelect,
    }),
  ])

  return NextResponse.json({
    activities: rows.map((row) => serializeActivityRow(row, new Date(), true)),
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

function moderationText(value: ReturnType<typeof normalizeActivityInput>) {
  if (!value.valid) return ''
  return [value.value.title, value.value.subtitle, value.value.description, value.value.feeDescription, value.value.locationName, value.value.locationAddress, value.value.organizer, value.value.contactInfo].filter(Boolean).join('\n')
}

export async function POST(request: Request) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const input = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const annual = input.annualMemoir != null
  const schedule = annual ? validateMemoirAdminInput(input.annualMemoir) : null
  const memoir = schedule?.ok ? schedule.data : null
  const points = annual ? parseMemoirPlatformPoints(input.platformPoints) : null
  if (annual) {
    const blocked = rejectInvalidRequestOrigin(request)
    if (blocked) return blocked
    if (schedule && !schedule.ok) return NextResponse.json({ message: schedule.message, field: schedule.field }, { status: 400 })
    if (!points) return NextResponse.json({ message: '请检查五个平台的奖励金额。', field: 'points-weibo' }, { status: 400 })
    const existing = await prisma.annualMemoirConfig.findUnique({ where: { year: 2026 }, select: { activityId: true } })
    if (existing) return NextResponse.json({ message: '2026 年年度活动已存在，请打开已有活动继续编辑。', activityId: existing.activityId }, { status: 409 })
  }
  const normalized = normalizeActivityInput(memoir ? {
    ...input, type: 'TOPIC_ACTIVITY', status: 'DRAFT',
    startsAt: memoir.previewAt.toISOString(), endsAt: memoir.endsAt.toISOString(),
  } : body)
  if (!normalized.valid) return NextResponse.json({ message: normalized.message }, { status: 400 })
  const topicConfig = normalizeTopicActivityConfig(input, normalized.value.type)
  if (!topicConfig.valid) return NextResponse.json({ message: topicConfig.message }, { status: 400 })
  if (normalized.value.type === 'TOPIC_ACTIVITY' && normalized.value.status === 'PUBLISHED' && !topicConfig.value.participationRule) return NextResponse.json({ message: '请填写话题活动参与方式' }, { status: 400 })
  if (topicConfig.value.participationRule && (await checkBannedWords(topicConfig.value.participationRule)).blocked) return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  if ((await checkBannedWords(moderationText(normalized))).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }

  const now = new Date()
  try {
    const activity = await prisma.$transaction(async (tx) => {
      const { linkedMaterialId, ...activityData } = normalized.value
      const created = await tx.activity.create({
        data: {
          ...activityData,
          ...topicConfig.value,
          ...(memoir ? { allowImageAttachments: true, pinToPlaza: input.pinToPlaza === true, participationRule: '上传分享截图，由管理员审核。' } : {}),
          publishedAt: normalized.value.status === 'PUBLISHED' ? now : null,
          createdById: guard.user.id,
          updatedById: guard.user.id,
        },
        select: activitySelect,
      })
      await syncActivityLinkedMaterial(tx, { activityId: created.id, linkedMaterialId, startsAt: created.startsAt, endsAt: created.endsAt })
      if (Object.prototype.hasOwnProperty.call(input, 'registrationQuestions')) await syncActivityRegistrationQuestions(tx, created.id, input.registrationQuestions)
      if (Object.prototype.hasOwnProperty.call(input, 'activityReward')) await syncActivityReward(tx, created.id, input.activityReward, normalized.value.verificationMode)
      if (topicConfig.value.rewardBadgeIds.length) {
        const availableBadges = await tx.badge.count({ where: { id: { in: topicConfig.value.rewardBadgeIds }, isEnabled: true, isActive: true } })
        if (availableBadges !== topicConfig.value.rewardBadgeIds.length) throw new ActivityConfigurationError('奖励勋章中包含不存在或已停用的勋章')
      }
      if (memoir && points) {
        if (await tx.annualMemoirConfig.findUnique({ where: { year: 2026 }, select: { activityId: true } })) {
          throw new ActivityConfigurationError('2026 年度活动已存在，请编辑现有活动。')
        }
        const badgeIds = [memoir.reservationBadgeId, memoir.annualBadgeId].filter((id): id is string => !!id)
        if (new Set(badgeIds).size !== badgeIds.length || await tx.badge.count({ where: { id: { in: badgeIds } } }) !== badgeIds.length) {
          throw new ActivityConfigurationError('请选择有效且不同的预约和年度勋章。')
        }
        await tx.annualMemoirConfig.create({ data: { ...memoir, activityId: created.id, year: 2026, enabled: false } })
        await syncMemoirPlatforms(tx, created.id, points)
      }
      await syncActivityPostInTransaction(tx, created.id, now)
      await createAdminActionAudit(tx, {
        operatorId: guard.user.id,
        action: 'CREATE_ACTIVITY',
        operationType: adminAuditOperations.ACTIVITY_CREATE,
        targetType: 'ACTIVITY',
        targetId: created.id,
        targetTitle: created.title,
        metadata: { activityId: created.id, status: created.status } as Prisma.InputJsonValue,
      })
      if (created.status === 'PUBLISHED') {
        await createAdminActionAudit(tx, {
          operatorId: guard.user.id,
          action: 'CREATE_ACTIVITY',
          operationType: adminAuditOperations.ACTIVITY_PUBLISH,
          targetType: 'ACTIVITY',
          targetId: created.id,
          targetTitle: created.title,
          metadata: { activityId: created.id, fromStatus: 'DRAFT', toStatus: 'PUBLISHED' } as Prisma.InputJsonValue,
        })
      }
      return tx.activity.findUniqueOrThrow({ where: { id: created.id }, select: activitySelect })
    })
    try {
      await grantEligibleActivityBadges({ activityId: activity.id })
    } catch (error) {
      console.error('[admin.activities.create.badge-reward-compensation]', { activityId: activity.id, error })
    }
    revalidatePath('/activities')
    revalidatePath('/')
    return NextResponse.json({ activity: serializeActivityRow(activity, new Date(), true) }, { status: 201 })
  } catch (error) {
    if (memoir) {
      const existing = await prisma.annualMemoirConfig.findUnique({ where: { year: 2026 }, select: { activityId: true } }).catch(() => null)
      if (existing) return NextResponse.json({ message: '2026 年年度活动已存在，请打开已有活动继续编辑。', activityId: existing.activityId }, { status: 409 })
    }
    if (error instanceof ActivityConfigurationError || error instanceof ActivityMaterialConfigurationError) return NextResponse.json({ message: error.message }, { status: 400 })
    console.error('[admin.activities.create]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: '创建活动失败，请稍后重试' }, { status: 500 })
  }
}
