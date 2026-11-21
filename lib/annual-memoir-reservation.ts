import type { Prisma } from '@prisma/client'
import { getMemoirAvailability } from '@/lib/annual-memoir-policy'
import { grantBadgeWithTransaction } from '@/lib/badge-service'
import { prisma } from '@/lib/prisma'
import { grantTopicActivityPointsInTransaction } from '@/lib/topic-activity-points'

export function getMemoirReservation(activityId: string, userId: string) {
  return prisma.annualMemoirReservation.findUnique({
    where: { activityId_userId: { activityId, userId } },
  })
}

export async function reserveMemoir(activityId: string, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT activityId FROM AnnualMemoirConfig WHERE activityId = ${activityId} FOR UPDATE`
    const existing = await tx.annualMemoirReservation.findUnique({
      where: { activityId_userId: { activityId, userId } },
    })
    if (existing) return { reservation: existing, created: false }
    const config = await tx.annualMemoirConfig.findUnique({
      where: { activityId },
      include: { activity: { select: { type: true, status: true, coverUrl: true } } },
    })
    if (!config) return null
    const now = new Date()
    const configuredAndPublished = config.enabled && config.activity.type === 'TOPIC_ACTIVITY' &&
      config.activity.status === 'PUBLISHED' && !!config.activity.coverUrl &&
      !!config.annualBadgeId && !!config.reservationBadgeId && config.reservationPoints >= 0
    if (!getMemoirAvailability({ schedule: config, now, hasSnapshot: false, configuredAndPublished }).canReserve) return null
    const reservation = await tx.annualMemoirReservation.create({
      data: { activityId, userId, createdAt: now, points: config.reservationPoints, badgeId: config.reservationBadgeId },
    })
    return { reservation, created: true }
  })
  if (!result?.created) return result?.reservation ?? null
  await fulfillMemoirReservation(result.reservation.id)
  return getMemoirReservation(activityId, userId)
}

async function lockReservation(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM AnnualMemoirReservation WHERE id = ${id} FOR UPDATE`
  return tx.annualMemoirReservation.findUnique({ where: { id } })
}

export async function fulfillMemoirReservation(id: string) {
  const points = await prisma.$transaction(async (tx) => {
    const row = await lockReservation(tx, id)
    if (!row || row.points <= 0 || row.pointsGrantedAt) return
    await grantTopicActivityPointsInTransaction(tx, {
      userId: row.userId, activityId: row.activityId, points: row.points,
      businessKey: `annual-memoir-reservation-points:${id}`,
      sourceEventId: id, reason: '年度回忆录预约奖励',
    })
    await tx.annualMemoirReservation.update({ where: { id }, data: { pointsGrantedAt: new Date() } })
  }).then(() => true, () => false)
  const badge = await prisma.$transaction(async (tx) => {
    const row = await lockReservation(tx, id)
    if (!row?.badgeId || row.badgeGrantedAt) return
    const grant = await grantBadgeWithTransaction(tx, {
      userId: row.userId, badgeId: row.badgeId, sourceType: 'TOPIC_ACTIVITY_REWARD',
      sourceId: row.activityId, grantKey: `annual-memoir-reservation-badge:${id}`,
      grantReason: '年度回忆录预约奖励', obtainedAt: row.createdAt,
    })
    if (grant.skipped) throw new Error('MEMOIR_RESERVATION_BADGE_UNAVAILABLE')
    await tx.annualMemoirReservation.update({ where: { id }, data: { badgeGrantedAt: new Date() } })
  }).then(() => true, () => false)
  if (!points || !badge) console.error('[annual-memoir.reservation.reward.pending]', { id, points, badge })
  return points && badge
}
