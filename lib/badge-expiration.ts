import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'

export type ExpireUserBadgesResult = {
  expiredCount: number
  clearedEquippedCount: number
}

/**
 * Mark due earning sources and aggregate UserBadge rows without deleting
 * history. If one source expires while another remains valid, the aggregate
 * badge stays active and its expiry is recalculated from the surviving source.
 */
export async function expireUserBadges(now = new Date(), batchSize = 500): Promise<ExpireUserBadgesResult> {
  const boundedBatchSize = Math.min(Math.max(Math.trunc(batchSize) || 500, 1), 1000)
  let expiredCount = 0
  let clearedEquippedCount = 0

  while (true) {
    const batch = await prisma.$transaction(async (tx) => {
      const [dueAggregates, dueSources] = await Promise.all([
        tx.userBadge.findMany({
          where: { status: 'ACTIVE', expiresAt: { not: null, lte: now } },
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          take: boundedBatchSize,
          select: { userId: true, badgeId: true },
        }),
        tx.userBadgeSource.findMany({
          where: { isActive: true, expiresAt: { not: null, lte: now } },
          orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
          take: boundedBatchSize,
          select: { userId: true, badgeId: true },
        }),
      ])
      const keys = new Map<string, { userId: string; badgeId: string }>()
      for (const row of [...dueAggregates, ...dueSources]) keys.set(`${row.userId}:${row.badgeId}`, row)
      if (!keys.size) return { expired: 0, cleared: 0, changes: [] as Array<{ userId: string; badgeId: string }> }

      const userIds = [...new Set([...keys.values()].map((row) => row.userId))].sort()
      await tx.$queryRaw`SELECT id FROM \`User\` WHERE id IN (${Prisma.join(userIds)}) FOR UPDATE`
      let expired = 0
      let cleared = 0
      const changes: Array<{ userId: string; badgeId: string }> = []

      for (const row of keys.values()) {
        const { userId, badgeId } = row
        const expiredSources = await tx.userBadgeSource.updateMany({
          where: { userId, badgeId, isActive: true, expiresAt: { not: null, lte: now } },
          data: { isActive: false, expiredAt: now },
        })
        const record = await tx.userBadge.findFirst({
          where: { userId, badgeId, status: 'ACTIVE' },
          orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
          select: { id: true, expiresAt: true },
        })
        if (!record) continue

        const survivingSources = await tx.userBadgeSource.findMany({
          where: { userId, badgeId, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          select: { expiresAt: true },
        })
        if (survivingSources.length) {
          const expiresAt = survivingSources.some((source) => !source.expiresAt)
            ? null
            : survivingSources.reduce<Date | null>((latest, source) => !latest || (source.expiresAt && source.expiresAt > latest) ? source.expiresAt : latest, null)
          if ((record.expiresAt?.getTime() || null) !== (expiresAt?.getTime() || null)) {
            await tx.userBadge.update({ where: { id: record.id }, data: { expiresAt, expiredAt: null, revokedAt: null, activeKey: activeBadgeKey(userId, badgeId) } })
          }
          continue
        }

        if (!expiredSources.count && (!record.expiresAt || record.expiresAt > now)) continue
        const updated = await tx.userBadge.updateMany({
          where: { id: record.id, status: 'ACTIVE' },
          data: { status: 'EXPIRED', expiredAt: now, activeKey: null },
        })
        if (!updated.count) continue
        expired += updated.count
        changes.push({ userId, badgeId })
        const clearedRelation = await tx.userEquippedBadge.deleteMany({ where: { userId, badgeId } })
        // Legacy cleanup remains until the old single-value column is removed.
        const clearedUser = await tx.user.updateMany({ where: { id: userId, equippedBadgeId: row.badgeId }, data: { equippedBadgeId: null } })
        cleared += Math.max(clearedRelation.count, clearedUser.count)
        await tx.userBadgeShowcase.deleteMany({ where: { userId, badgeId } })
      }
      return { expired, cleared, changes }
    })

    expiredCount += batch.expired
    clearedEquippedCount += batch.cleared
    for (const change of batch.changes) {
      try {
        const { triggerBadgeOwnershipRecheck } = await import('@/lib/badge-ownership')
        await triggerBadgeOwnershipRecheck(change.userId, change.badgeId)
      } catch (error) {
        console.error('[badge.expiration.ownership-recheck]', { ...change, error })
      }
    }
    if (batch.expired === 0 || batch.expired < boundedBatchSize) break
  }

  return { expiredCount, clearedEquippedCount }
}

function activeBadgeKey(userId: string, badgeId: string) {
  return createHash('sha256').update(`active:${userId}:${badgeId}`).digest('hex')
}
