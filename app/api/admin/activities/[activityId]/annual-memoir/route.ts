import { annualMemoirPlatforms } from '@/lib/annual-memoir-platforms'
import { parseMemoirPlatformPoints, syncMemoirPlatforms } from '@/lib/annual-memoir-platform-admin'
import { readTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { normalizeActivityInput } from '@/lib/activity-validation'
import { syncActivityPostInTransaction } from '@/lib/topic-activity'
import { checkBannedWords } from '@/lib/content-moderation'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { parseMemoirAdminInput } from '@/lib/annual-memoir-admin'
import { fulfillMemoirReservation } from '@/lib/annual-memoir-reservation'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

type Context = { params: Promise<{ activityId: string }> }
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function GET(_request: Request, { params }: Context) {
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  const [config, badges, outstanding, reservations, reports, notified, settled, medals, points] = await Promise.all([
    prisma.annualMemoirConfig.findUnique({ where: { activityId } }),
    prisma.badge.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.annualMemoirReservation.findMany({ where: { activityId, OR: [{ points: { gt: 0 }, pointsGrantedAt: null }, { badgeId: { not: null }, badgeGrantedAt: null }] },
      take: 50, orderBy: { id: 'asc' }, select: { id: true, user: { select: { uid: true } } } }),
    prisma.annualMemoirReservation.count({ where: { activityId } }),
    prisma.annualMemoirSnapshot.count({ where: { activityId } }),
    prisma.annualMemoirReservation.count({ where: { activityId, notifiedAt: { not: null } } }),
    prisma.annualMemoirSnapshot.count({ where: { activityId, settledAt: { not: null } } }),
    prisma.annualMemoirReservation.count({ where: { activityId, badgeGrantedAt: { not: null } } }),
    prisma.annualMemoirReservation.aggregate({ where: { activityId, pointsGrantedAt: { not: null } }, _sum: { points: true } }),
  ])
  const activity = await prisma.activity.findUnique({ where: { id: activityId }, select: { topicProgram: true } })
  const entries = readTopicActivityV2Program(activity?.topicProgram)?.entries ?? []
  const platformPoints = annualMemoirPlatforms.map(([key]) => entries.find((entry) => entry.enabled && entry.platformKey === key)?.points ?? 74)
  return reply({ config, badges, outstanding, platformPoints, stats: { reservations, reports, notified, settled, medals, points: points._sum.points ?? 0 } })
}

export async function PUT(request: Request, { params }: Context) {
  const blocked = rejectInvalidRequestOrigin(request)
  if (blocked) return blocked
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const actorId = guard.user.id
  const { activityId } = await params
  const body = await request.json().catch(() => null)
  const data = parseMemoirAdminInput(body)
  const points = body?.platformPoints === undefined ? undefined : parseMemoirPlatformPoints(body.platformPoints)
  if (points === null) return reply({ message: '请为五个平台设置有效的挂号费。' }, 400)
  if (!data) return reply({ message: '请检查北京时间及奖励金额。' }, 400)
  const normalized = body.activity ? normalizeActivityInput({
    ...body.activity, type: 'TOPIC_ACTIVITY', status: 'DRAFT',
    startsAt: data.previewAt.toISOString(), endsAt: data.endsAt.toISOString(),
  }) : null
  if (normalized && !normalized.valid) return reply({ message: normalized.message }, 400)
  if (normalized?.valid && (await checkBannedWords([normalized.value.title, normalized.value.subtitle, normalized.value.description].join(' '))).blocked) {
    return reply({ message: '请检查活动文本。' }, 400)
  }
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Activity WHERE id = ${activityId} FOR UPDATE`
    await tx.$queryRaw`SELECT activityId FROM AnnualMemoirConfig WHERE activityId = ${activityId} FOR UPDATE`
    const current = await tx.annualMemoirConfig.findUnique({ where: { activityId } })
    if (current?.statisticsLockedAt && (current.statisticsStartAt.getTime() !== data.statisticsStartAt.getTime() ||
      current.statisticsEndAt.getTime() !== data.statisticsEndAt.getTime())) return 'LOCKED'
    const activity = await tx.activity.findUnique({ where: { id: activityId }, select: { type: true, coverUrl: true } })
    if (activity?.type !== 'TOPIC_ACTIVITY') return 'INVALID'
    const ids = [data.reservationBadgeId, data.annualBadgeId].filter((id): id is string => !!id)
    if (new Set(ids).size !== ids.length || (ids.length && await tx.badge.count({ where: { id: { in: ids } } }) !== ids.length) ||
      (data.enabled && (!(normalized?.valid ? normalized.value.coverUrl : activity.coverUrl)?.trim() || !data.annualBadgeId))) return 'INVALID'
    await tx.annualMemoirConfig.upsert({ where: { activityId }, update: data, create: { activityId, year: 2026, ...data } })
    if (normalized?.valid) {
      const { title, subtitle, description, coverUrl, isFeatured, startsAt, endsAt } = normalized.value
      const pinToPlaza = body.activity.pinToPlaza === true
      await tx.activity.update({ where: { id: activityId }, data: {
        title, subtitle, description, coverUrl, isFeatured, pinToPlaza, startsAt, endsAt,
        allowImageAttachments: true, updatedById: actorId,
      } })
      await syncActivityPostInTransaction(tx, activityId)
    }
    if (!current?.enabled || points) await syncMemoirPlatforms(tx, activityId, points)
    await tx.adminActionLog.create({ data: { adminId: actorId, targetUserId: actorId,
      action: 'ANNUAL_MEMOIR_CONFIG_UPDATED', detail: { activityId, enabled: data.enabled } } })
    return 'SAVED'
  })
  if (result !== 'SAVED') return reply({ message: result === 'LOCKED' ? '首份报告已生成，统计范围已锁定。' : '请检查话题活动、正式封面及两种勋章。' }, 409)
  revalidatePath('/activities')
  revalidatePath('/')
  return reply({ ok: true })
}

export async function POST(request: Request, { params }: Context) {
  const blocked = rejectInvalidRequestOrigin(request)
  if (blocked) return blocked
  const guard = await requireAdmin('activity_manage')
  if (!guard.user) return guard.response
  const { activityId } = await params
  const body = await request.json().catch(() => null)
  if (typeof body?.reservationId !== 'string') return reply({ message: '请选择预约记录。' }, 400)
  const row = await prisma.annualMemoirReservation.findFirst({
    where: { id: body.reservationId, activityId, OR: [{ points: { gt: 0 }, pointsGrantedAt: null }, { badgeId: { not: null }, badgeGrantedAt: null }] },
  })
  if (!row) return reply({ message: '没有待补发的奖励。' }, 404)
  await prisma.adminActionLog.create({ data: { adminId: guard.user.id, targetUserId: row.userId,
    action: 'ANNUAL_MEMOIR_REWARD_RETRY', detail: { activityId, reservationId: row.id } } })
  const ok = await fulfillMemoirReservation(row.id)
  return reply({ ok, message: ok ? '补发已完成。' : '仍有奖励未到账，后台任务将继续重试。' }, ok ? 200 : 409)
}
