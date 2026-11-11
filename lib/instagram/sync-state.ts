import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  ANYWHERE_DOOR_PROVIDER,
  ANYWHERE_DOOR_TARGET,
  ANYWHERE_DOOR_SYNC_LOCK_KEY,
  getAnywhereDoorConfig,
} from '@/lib/anywhere-door/config'

export type SyncStateDb = Pick<PrismaClient, 'socialSyncState' | 'socialSyncLog' | '$transaction'>
export type InstagramLeaseExecutionContext = {
  target: string
  token: string
  generation: bigint
  db?: Pick<PrismaClient, '$transaction'>
  signal?: AbortSignal
  isLost?: () => boolean
  assertActive: () => void
}

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

export async function requestInstagramSync(input: {
  target?: string
  requestedAt?: Date
  lease: InstagramLeaseExecutionContext
  db?: Pick<PrismaClient, '$transaction'>
}) {
  const target = input.target || ANYWHERE_DOOR_TARGET
  if (input.lease.target !== target) throw new Error('INSTAGRAM_LEASE_TARGET_MISMATCH')
  return withInstagramLeaseTransaction({
    target,
    token: input.lease.token,
    generation: input.lease.generation,
    signal: input.lease.signal,
    isLost: input.lease.isLost,
    assertActive: input.lease.assertActive,
    db: input.db || input.lease.db,
  }, (tx) => tx.socialSyncState.update({
    where: { platform_target: { platform: 'INSTAGRAM', target } },
    data: { syncRequestedAt: input.requestedAt || new Date() },
  }))
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
  const leaseMs = input.leaseMs ?? 5 * 60 * 1000
  const token = input.token ?? randomUUID()
  if (!target.trim() || target.length > 191) throw new TypeError('INVALID_INSTAGRAM_LEASE_TARGET')
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0 || !Number.isSafeInteger(leaseMs * 1000)) throw new TypeError('INVALID_INSTAGRAM_LEASE_TTL')
  if (!token || token.length > 64) throw new TypeError('INVALID_INSTAGRAM_LEASE_TOKEN')
  const db = input.db || prisma
  const state = await getInstagramSyncState(target, db)
  const generation = await db.$transaction(async (tx) => {
    const changed = await tx.$executeRaw`
      UPDATE SocialSyncState
      SET lockToken = ${token},
          lockUntil = TIMESTAMPADD(MICROSECOND, ${leaseMs * 1000}, UTC_TIMESTAMP(3)),
          leaseGeneration = leaseGeneration + 1
      WHERE id = ${state.id}
        AND (lockUntil IS NULL OR lockUntil <= UTC_TIMESTAMP(3))
    `
    if (changed !== 1) return null
    const rows = await tx.$queryRaw<Array<{ leaseGeneration: bigint; lockUntil: Date }>>`
      SELECT leaseGeneration, lockUntil FROM SocialSyncState
      WHERE id = ${state.id} AND lockToken = ${token}
      FOR UPDATE
    `
    if (rows.length === 1) return { generation: rows[0].leaseGeneration, lockUntil: rows[0].lockUntil }
    await tx.$executeRaw`UPDATE SocialSyncState SET lockToken = NULL, lockUntil = NULL WHERE id = ${state.id} AND lockToken = ${token}`
    return null
  })
  return {
    acquired: generation !== null,
    token,
    generation: generation?.generation ?? null,
    lockKey: buildInstagramSyncLockKey(target),
    lockUntil: generation?.lockUntil ?? null,
  }
}

export function buildInstagramSyncLockKey(target = ANYWHERE_DOOR_TARGET) {
  return `anywhere-door-instagram-sync:${target}`
}

/** Hold the lease row lock through the write so a replacement owner cannot race it. */
export async function withInstagramLeaseTransaction<T>(input: {
  target: string
  token: string
  generation: bigint
  signal?: AbortSignal
  isLost?: () => boolean
  assertActive?: () => void
  db?: Pick<PrismaClient, '$transaction'>
}, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  if (!input.target || !input.token || typeof input.generation !== 'bigint' || input.generation < BigInt(1)) throw new Error('INSTAGRAM_LEASE_INVALID')
  input.assertActive?.()
  const db = input.db || prisma
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM SocialSyncState
      WHERE platform = 'INSTAGRAM' AND target = ${input.target}
        AND lockToken = ${input.token} AND leaseGeneration = ${input.generation}
        AND lockUntil > UTC_TIMESTAMP(3)
      FOR UPDATE
    `
    if (rows.length !== 1) throw new Error('INSTAGRAM_LEASE_LOST')
    input.assertActive?.()
    return write(tx)
  })
}

/** Renew only a still-live lease owned by this token; an expired lease cannot be revived. */
export async function renewInstagramSyncLease(input: {
  target: string
  token: string
  generation: bigint
  now: Date
  leaseMs: number
  db?: SyncStateDb
}) {
  if (!input.token || typeof input.generation !== 'bigint' || input.generation < BigInt(1) || !Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0 || !Number.isFinite(input.now.getTime())) return false
  const db = input.db || prisma
  const changed = await db.$transaction((tx) => tx.$executeRaw`
    UPDATE SocialSyncState
    SET lockUntil = TIMESTAMPADD(MICROSECOND, ${input.leaseMs * 1000}, UTC_TIMESTAMP(3))
    WHERE platform = 'INSTAGRAM' AND target = ${input.target}
      AND lockToken = ${input.token} AND leaseGeneration = ${input.generation}
      AND lockUntil > UTC_TIMESTAMP(3)
  `
  )
  return changed === 1
}

export async function releaseInstagramSyncLease(target = ANYWHERE_DOOR_TARGET, token: string, generation: bigint, db: SyncStateDb = prisma) {
  if (!token || token.length > 64 || typeof generation !== 'bigint' || generation < BigInt(1)) return false
  const changed = await db.$transaction((tx) => tx.$executeRaw`
    UPDATE SocialSyncState
    SET lockToken = NULL, lockUntil = NULL
    WHERE platform = 'INSTAGRAM' AND target = ${target}
      AND lockToken = ${token} AND leaseGeneration = ${generation}
      AND lockUntil > UTC_TIMESTAMP(3)
  `)
  return changed === 1
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
