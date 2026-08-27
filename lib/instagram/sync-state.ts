import { randomUUID } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  ANYWHERE_DOOR_PROVIDER,
  ANYWHERE_DOOR_TARGET,
  ANYWHERE_DOOR_SYNC_LOCK_KEY,
  getAnywhereDoorConfig,
} from '@/lib/anywhere-door/config'

export type SyncStateDb = Pick<PrismaClient, 'socialSyncState' | 'socialSyncLog'>

export type SyncStateRecord = Awaited<ReturnType<typeof getInstagramSyncState>>

/** Read-only status lookup. Unlike getInstagramSyncState, this never creates a row. */
export async function findInstagramSyncState(target = ANYWHERE_DOOR_TARGET, db: SyncStateDb = prisma) {
  return db.socialSyncState.findUnique({
    where: { platform_target: { platform: 'INSTAGRAM', target } },
  })
}

export async function getInstagramSyncState(target = ANYWHERE_DOOR_TARGET, db: SyncStateDb = prisma) {
  const existing = await db.socialSyncState.findUnique({
    where: { platform_target: { platform: 'INSTAGRAM', target } },
  })
  if (existing) return existing

  try {
    return await db.socialSyncState.create({ data: { platform: 'INSTAGRAM', target } })
  } catch {
    // Another worker may have won the create race. Read the same singleton
    // instead of treating that harmless race as a failed sync.
    return db.socialSyncState.findUniqueOrThrow({
      where: { platform_target: { platform: 'INSTAGRAM', target } },
    })
  }
}

export async function requestInstagramSync(target = ANYWHERE_DOOR_TARGET, requestedAt = new Date(), db: SyncStateDb = prisma) {
  const state = await getInstagramSyncState(target, db)
  return db.socialSyncState.update({
    where: { id: state.id },
    data: { syncRequestedAt: requestedAt },
  })
}

/**
 * A database-backed lease is used instead of an in-memory boolean. The
 * conditional update is atomic in MySQL, so two worker processes cannot both
 * claim the same target. The lock key is stable for observability and tests.
 */
export async function acquireInstagramSyncLease(input: {
  target?: string
  now?: Date
  leaseMs?: number
  token?: string
  db?: SyncStateDb
}) {
  const target = input.target || ANYWHERE_DOOR_TARGET
  const now = input.now || new Date()
  const leaseMs = input.leaseMs || 5 * 60 * 1000
  const token = input.token || randomUUID()
  const db = input.db || prisma
  const state = await getInstagramSyncState(target, db)
  const result = await db.socialSyncState.updateMany({
    where: {
      id: state.id,
      OR: [{ lockUntil: null }, { lockUntil: { lt: now } }],
    },
    data: { lockToken: token, lockUntil: new Date(now.getTime() + leaseMs) },
  })
  return {
    acquired: result.count === 1,
    token,
    lockKey: buildInstagramSyncLockKey(target),
    lockUntil: new Date(now.getTime() + leaseMs),
  }
}

export function buildInstagramSyncLockKey(target = ANYWHERE_DOOR_TARGET) {
  return `anywhere-door-instagram-sync:${target}`
}

export async function releaseInstagramSyncLease(target = ANYWHERE_DOOR_TARGET, token: string, db: SyncStateDb = prisma) {
  if (!token) return false
  const result = await db.socialSyncState.updateMany({
    where: { platform: 'INSTAGRAM', target, lockToken: token },
    data: { lockToken: null, lockUntil: null },
  })
  return result.count === 1
}

export async function countProviderRunsSince(target: string, start: Date, db: SyncStateDb = prisma) {
  return db.socialSyncLog.count({ where: { target, startedAt: { gte: start } } })
}

export async function canStartProviderRun(target = ANYWHERE_DOOR_TARGET, now = new Date(), db: SyncStateDb = prisma) {
  const config = getAnywhereDoorConfig()
  const dayStart = new Date(now)
  dayStart.setUTCHours(0, 0, 0, 0)
  const [runsToday, latest] = await Promise.all([
    countProviderRunsSince(target, dayStart, db),
    db.socialSyncLog.findFirst({ where: { target }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
  ])
  const cooldownMs = config.providerRunCooldownMinutes * 60 * 1000
  return {
    allowed: runsToday < config.maxProviderRunsPerDay && (!latest || now.getTime() - latest.startedAt.getTime() >= cooldownMs),
    runsToday,
    maxRunsPerDay: config.maxProviderRunsPerDay,
    lastStartedAt: latest?.startedAt || null,
    cooldownMinutes: config.providerRunCooldownMinutes,
  }
}

export const instagramSyncStateDefaults = {
  platform: 'INSTAGRAM' as const,
  target: ANYWHERE_DOOR_TARGET,
  provider: ANYWHERE_DOOR_PROVIDER,
  lockKey: ANYWHERE_DOOR_SYNC_LOCK_KEY,
}
