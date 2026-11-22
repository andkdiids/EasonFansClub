import { fulfillMemoirReservation } from '@/lib/annual-memoir-reservation'
import { getMemoirAvailability } from '@/lib/annual-memoir-policy'
import { upsertNotificationWithDb } from '@/lib/notification-write'
import { prisma } from '@/lib/prisma'
import { grantBadgeWithTransaction } from '@/lib/badge-service'

let rewardCursor: string | undefined
let noticeCursor: string | undefined
let settlementCursor: string | undefined

async function settleSnapshot(id: string, now: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM AnnualMemoirSnapshot WHERE id = ${id} FOR UPDATE`
    const row = await tx.annualMemoirSnapshot.findUnique({
      where: { id }, include: { activity: { include: { annualMemoirConfig: true } } },
    })
    const config = row?.activity.annualMemoirConfig
    if (!row || row.settledAt || !config?.enabled || !config.annualBadgeId ||
      row.activity.type !== 'TOPIC_ACTIVITY' || row.activity.status !== 'PUBLISHED' ||
      config.settlementAt < config.endsAt || now < config.settlementAt ||
      row.createdAt < config.reportOpensAt || row.createdAt >= config.endsAt) return
    const grant = await grantBadgeWithTransaction(tx, {
      userId: row.userId, badgeId: config.annualBadgeId, sourceType: 'TOPIC_ACTIVITY_REWARD',
      sourceId: row.activityId, grantKey: `annual-memoir-completion:${id}`,
      grantReason: '葡萄成熟时年度限定勋章', obtainedAt: now,
    })
    if (grant.skipped) throw new Error('MEMOIR_ANNUAL_BADGE_UNAVAILABLE')
    await tx.annualMemoirSnapshot.update({ where: { id }, data: { settledAt: now } })
  })
}

async function notifyReservation(id: string, now: Date) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM AnnualMemoirReservation WHERE id = ${id} FOR UPDATE`
    const row = await tx.annualMemoirReservation.findUnique({
      where: { id }, include: { activity: { include: { annualMemoirConfig: true } } },
    })
    const config = row?.activity.annualMemoirConfig
    if (!row || row.notifiedAt || !config) return
    const configuredAndPublished = config.enabled && row.activity.status === 'PUBLISHED' &&
      row.activity.type === 'TOPIC_ACTIVITY' && !!row.activity.coverUrl &&
      !!config.annualBadgeId
    if (!getMemoirAvailability({ schedule: config, now, hasSnapshot: false, configuredAndPublished }).canNotify) return
    const key = `annual-memoir-open:${row.activityId}`
    await upsertNotificationWithDb(tx, {
      where: { recipientId_key: { recipientId: row.userId, key } },
      create: {
        recipientId: row.userId, key, type: 'ADMIN',
        title: `你的 ${config.year} 年度回忆录已开启！`,
        content: `《葡萄成熟时》正式开启。那些留在私家E院的故事，已经悄悄成熟。现在，来生成属于你的 ${config.year} 年度回忆录吧！`,
        link: `/activities/${encodeURIComponent(row.activityId)}/annual-memoir`,
      },
      update: {},
    })
    await tx.annualMemoirReservation.update({ where: { id }, data: { notifiedAt: now } })
  })
}

export async function runAnnualMemoirMaintenance(now = new Date()) {
  // Rotate through pending rows so a permanently unavailable badge or failed
  // notification cannot starve later users. Unfinished rows stay in MySQL.
  const rewards = await prisma.annualMemoirReservation.findMany({
    where: {
      id: rewardCursor ? { gt: rewardCursor } : undefined,
      OR: [{ points: { gt: 0 }, pointsGrantedAt: null }, { badgeId: { not: null }, badgeGrantedAt: null }],
    },
    orderBy: { id: 'asc' }, take: 25, select: { id: true },
  })
  rewardCursor = rewards.length === 25 ? rewards.at(-1)?.id : undefined
  for (const row of rewards) await fulfillMemoirReservation(row.id)

  const notices = await prisma.annualMemoirReservation.findMany({
    where: {
      id: noticeCursor ? { gt: noticeCursor } : undefined,
      notifiedAt: null,
      activity: { status: 'PUBLISHED', annualMemoirConfig: { enabled: true, notificationAt: { lte: now }, reportOpensAt: { lte: now }, endsAt: { gt: now } } },
    },
    orderBy: { id: 'asc' }, take: 50, select: { id: true },
  })
  noticeCursor = notices.length === 50 ? notices.at(-1)?.id : undefined
  for (const row of notices) {
    try {
      await notifyReservation(row.id, now)
    } catch (error) {
      console.error('[annual-memoir.notice.pending]', { id: row.id, errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    }
  }

  const snapshots = await prisma.annualMemoirSnapshot.findMany({
    where: {
      id: settlementCursor ? { gt: settlementCursor } : undefined,
      settledAt: null,
      activity: { status: 'PUBLISHED', annualMemoirConfig: { enabled: true, annualBadgeId: { not: null }, settlementAt: { lte: now }, endsAt: { lte: now } } },
    },
    orderBy: { id: 'asc' }, take: 25, select: { id: true },
  })
  settlementCursor = snapshots.length === 25 ? snapshots.at(-1)?.id : undefined
  for (const row of snapshots) {
    try {
      await settleSnapshot(row.id, now)
    } catch (error) {
      console.error('[annual-memoir.settlement.pending]', { id: row.id, errorName: error instanceof Error ? error.name : 'UNKNOWN' })
    }
  }
}
