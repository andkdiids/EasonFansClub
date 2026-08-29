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
  if (status === 'ENDED') and.push({ status: 'PUBLISHED', endsAt: { lte: new Date() } })
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
    activities: rows.map((row) => serializeActivityRow(row)),
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
  const normalized = normalizeActivityInput(body)
  if (!normalized.valid) return NextResponse.json({ message: normalized.message }, { status: 400 })
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
          publishedAt: normalized.value.status === 'PUBLISHED' ? now : null,
          createdById: guard.user.id,
          updatedById: guard.user.id,
        },
        select: activitySelect,
      })
      await syncActivityLinkedMaterial(tx, { activityId: created.id, linkedMaterialId, startsAt: created.startsAt, endsAt: created.endsAt })
      if (Object.prototype.hasOwnProperty.call(input, 'registrationQuestions')) await syncActivityRegistrationQuestions(tx, created.id, input.registrationQuestions)
      if (Object.prototype.hasOwnProperty.call(input, 'activityReward')) await syncActivityReward(tx, created.id, input.activityReward, normalized.value.verificationMode)
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
    revalidatePath('/activities')
    revalidatePath('/')
    return NextResponse.json({ activity: serializeActivityRow(activity) }, { status: 201 })
  } catch (error) {
    if (error instanceof ActivityConfigurationError || error instanceof ActivityMaterialConfigurationError) return NextResponse.json({ message: error.message }, { status: 400 })
    console.error('[admin.activities.create]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: '创建活动失败，请稍后重试' }, { status: 500 })
  }
}
