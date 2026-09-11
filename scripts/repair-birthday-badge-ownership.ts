import 'dotenv/config'

import { createHash } from 'node:crypto'

import { BIRTHDAY_BADGE_SLUG } from '../lib/birthday-constants'
import { prisma } from '../lib/prisma'

const INCIDENT_START = new Date('2026-09-10T16:00:00.000Z')
const INCIDENT_END = new Date('2026-09-11T16:00:00.000Z')

type RepairRow = {
  userId: string
  uid: number
  badgeId: string
  badgeName: string
  userBadgeId: string
  sourceId: string
  originalAcquiredAt: Date
  originalCreatedAt: Date
  sourceGrantedAt: Date
  currentStatus: string
  sourceActive: boolean
  sourceRevokedAt: Date | null
  sourceRevokeReason: string | null
  userBadgeRevokedAt: Date | null
  userBadgeRevokeReason: string | null
  expiresAt: Date | null
  repairAction: string
}

function activeBadgeKey(userId: string, badgeId: string) {
  return createHash('sha256').update(`active:${userId}:${badgeId}`).digest('hex')
}

/**
 * Find only the ownership rows produced by the old birthday retention incident.
 * The incident window and the exact legacy source identity are intentional:
 * this must never become a general birthday regrant or badge scan.
 */
async function loadRepairRows(): Promise<RepairRow[]> {
  const badge = await prisma.badge.findUnique({
    where: { slug: BIRTHDAY_BADGE_SLUG },
    select: {
      id: true,
      name: true,
      grantType: true,
      validityType: true,
      validityDays: true,
      BadgeRule: { select: { ruleType: true, retentionPolicy: true, sustainedQualification: true } },
    },
  })
  if (!badge) throw new Error(`找不到生日勋章 ${BIRTHDAY_BADGE_SLUG}`)
  if (badge.grantType !== 'AUTO' || badge.validityType !== 'PERMANENT' || badge.validityDays != null) {
    throw new Error('生日勋章当前不是 AUTO + PERMANENT，已停止 repair')
  }
  if (badge.BadgeRule?.ruleType !== 'BIRTHDAY_TODAY' || badge.BadgeRule.sustainedQualification === true) {
    throw new Error('生日勋章规则不是 acquisition-only BIRTHDAY_TODAY，已停止 repair')
  }

  const rows = await prisma.userBadgeSource.findMany({
    where: {
      badgeId: badge.id,
      sourceType: 'AUTO',
      sourceId: BIRTHDAY_BADGE_SLUG,
      isActive: false,
      revokedAt: { gte: INCIDENT_START, lt: INCIDENT_END },
      revokeReason: 'SYSTEM_REVOKED',
      UserBadge: {
        status: 'REVOKED',
        expiresAt: null,
        revokedAt: { gte: INCIDENT_START, lt: INCIDENT_END },
      },
    },
    orderBy: [{ revokedAt: 'asc' }, { id: 'asc' }],
    select: {
      userId: true,
      userBadgeId: true,
      id: true,
      grantedAt: true,
      revokedAt: true,
      revokeReason: true,
      User: { select: { uid: true } },
      UserBadge: {
        select: {
          id: true,
          status: true,
          grantedAt: true,
          createdAt: true,
          revokedAt: true,
          revokeReason: true,
          expiresAt: true,
        },
      },
    },
  })

  return rows.map((row) => ({
    userId: row.userId,
    uid: row.User.uid,
    badgeId: badge.id,
    badgeName: badge.name,
    userBadgeId: row.UserBadge.id,
    sourceId: row.id,
    originalAcquiredAt: row.UserBadge.grantedAt,
    originalCreatedAt: row.UserBadge.createdAt,
    sourceGrantedAt: row.grantedAt,
    currentStatus: row.UserBadge.status,
    sourceActive: false,
    sourceRevokedAt: row.revokedAt,
    sourceRevokeReason: row.revokeReason,
    userBadgeRevokedAt: row.UserBadge.revokedAt,
    userBadgeRevokeReason: row.UserBadge.revokeReason,
    expiresAt: row.UserBadge.expiresAt,
    repairAction: 'REVOKED → ACTIVE；恢复原 source，不创建 UserBadge，不发送通知',
  }))
}

function printPreview(rows: RepairRow[]) {
  console.info(JSON.stringify({
    mode: 'REPAIR_PREVIEW',
    incident: {
      timezone: 'Asia/Shanghai',
      start: INCIDENT_START.toISOString(),
      end: INCIDENT_END.toISOString(),
      badge: BIRTHDAY_BADGE_SLUG,
    },
    affectedUsers: new Set(rows.map((row) => row.userId)).size,
    rows,
    productionMutated: false,
  }, null, 2))
}

async function applyRepair(expectedCount: number) {
  const rows = await loadRepairRows()
  printPreview(rows)
  if (rows.length !== expectedCount) {
    throw new Error(`repair preview 数量已变化：确认值 ${expectedCount}，当前 ${rows.length}；已停止写入`)
  }

  let updated = 0
  for (const row of rows) {
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.userBadgeSource.findUnique({
        where: { id: row.sourceId },
        select: {
          id: true,
          userId: true,
          badgeId: true,
          userBadgeId: true,
          isActive: true,
          sourceType: true,
          sourceId: true,
          revokeReason: true,
          UserBadge: { select: { id: true, status: true, expiresAt: true } },
        },
      })
      if (!current
        || current.userId !== row.userId
        || current.badgeId !== row.badgeId
        || current.userBadgeId !== row.userBadgeId
        || current.isActive
        || current.sourceType !== 'AUTO'
        || current.sourceId !== BIRTHDAY_BADGE_SLUG
        || current.revokeReason !== 'SYSTEM_REVOKED'
        || current.UserBadge.status !== 'REVOKED'
        || current.UserBadge.expiresAt !== null) {
        return { updated: false }
      }

      const ownership = await tx.userBadge.updateMany({
        where: {
          id: row.userBadgeId,
          userId: row.userId,
          badgeId: row.badgeId,
          status: 'REVOKED',
          expiresAt: null,
        },
        data: {
          status: 'ACTIVE',
          revokedAt: null,
          revokeReason: null,
          activeKey: activeBadgeKey(row.userId, row.badgeId),
        },
      })
      if (ownership.count !== 1) throw new Error(`UserBadge ${row.userBadgeId} 未能被唯一恢复`)

      const source = await tx.userBadgeSource.updateMany({
        where: {
          id: row.sourceId,
          userId: row.userId,
          badgeId: row.badgeId,
          userBadgeId: row.userBadgeId,
          sourceType: 'AUTO',
          sourceId: BIRTHDAY_BADGE_SLUG,
          isActive: false,
          revokeReason: 'SYSTEM_REVOKED',
        },
        data: {
          isActive: true,
          revokedAt: null,
          revokeReason: null,
        },
      })
      if (source.count !== 1) throw new Error(`UserBadgeSource ${row.sourceId} 未能被唯一恢复`)
      return { updated: true }
    })
    if (result.updated) updated += 1
  }

  const after = await loadRepairRows()
  const verified = await Promise.all(rows.map(async (row) => {
    const ownership = await prisma.userBadge.findUnique({
      where: { id: row.userBadgeId },
      select: {
        id: true,
        userId: true,
        badgeId: true,
        status: true,
        grantedAt: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
        revokeReason: true,
        UserBadgeSource: {
          where: { id: row.sourceId },
          select: { id: true, isActive: true, grantedAt: true, revokedAt: true, revokeReason: true },
        },
      },
    })
    const activeCount = await prisma.userBadge.count({ where: { userId: row.userId, badgeId: row.badgeId, status: 'ACTIVE' } })
    return {
      userId: row.userId,
      userBadgeId: row.userBadgeId,
      status: ownership?.status || null,
      grantedAt: ownership?.grantedAt || null,
      createdAt: ownership?.createdAt || null,
      expiresAt: ownership?.expiresAt || null,
      revokedAt: ownership?.revokedAt || null,
      revokeReason: ownership?.revokeReason || null,
      source: ownership?.UserBadgeSource[0] || null,
      activeOwnershipCountForUserBadge: activeCount,
    }
  }))
  console.info(JSON.stringify({
    mode: 'REPAIR_RESULT',
    productionMutated: updated > 0,
    updated,
    remainingPreviewRows: after.length,
    newUserBadge: 0,
    notificationsSent: 0,
    verified,
  }, null, 2))
}

async function main() {
  const rows = await loadRepairRows()
  if (!process.argv.includes('--apply')) {
    printPreview(rows)
    return
  }
  const confirmationIndex = process.argv.indexOf('--confirm-count')
  const expectedCount = confirmationIndex >= 0 ? Number(process.argv[confirmationIndex + 1]) : NaN
  if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
    throw new Error(`正式 repair 必须提供 --confirm-count ${rows.length}`)
  }
  await applyRepair(expectedCount)
}

main()
  .catch((error) => {
    console.error('[repair-birthday-badge-ownership] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
