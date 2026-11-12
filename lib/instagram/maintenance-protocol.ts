import { Prisma, type PrismaClient } from '@prisma/client'
import { createMySqlAdvisoryLockName } from '@/lib/mysql-advisory-lock'

const DEFAULT_WORKER_TRANSACTION_TIMEOUT_MS = 8 * 60 * 1000
const DEFAULT_DRAIN_TIMEOUT_MS = 8 * 60 * 1000
const DEFAULT_DRAIN_POLL_MS = 250

type LockSession = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw' | 'siteSetting'>

export class InstagramAdmissionUnavailableError extends Error {
  readonly code = 'INSTAGRAM_ADMISSION_UNAVAILABLE'

  constructor() {
    super('Instagram worker admission is held or another worker is active')
    this.name = 'InstagramAdmissionUnavailableError'
  }
}

export class InstagramMaintenanceDrainTimeoutError extends Error {
  readonly code = 'INSTAGRAM_MAINTENANCE_DRAIN_TIMEOUT'

  constructor() {
    super('Instagram workers did not drain before the maintenance deadline')
    this.name = 'InstagramMaintenanceDrainTimeoutError'
  }
}

export class InstagramLeaseStateInconsistentError extends Error {
  readonly code = 'INSTAGRAM_LEASE_STATE_INCONSISTENT'

  constructor() {
    super('Instagram lease state is inconsistent; maintenance must stop')
    this.name = 'InstagramLeaseStateInconsistentError'
  }
}

function lockNames(target: string) {
  if (!target.trim()) throw new TypeError('INSTAGRAM_TARGET_REQUIRED')
  return {
    admission: createMySqlAdvisoryLockName('instagram-admission', target),
    active: createMySqlAdvisoryLockName('instagram-active-task', target),
  }
}

function holdKey(target: string) {
  return `instagram_worker_maintenance_hold:${target}`
}

async function tryAcquireLock(session: LockSession, name: string) {
  const rows = await session.$queryRaw<Array<{ acquired: number | bigint | null }>>`
    SELECT GET_LOCK(${name}, 0) AS acquired
  `
  return Number(rows[0]?.acquired) === 1
}

async function releaseLock(session: LockSession, name: string) {
  const rows = await session.$queryRaw<Array<{ released: number | bigint | null }>>`
    SELECT RELEASE_LOCK(${name}) AS released
  `
  if (Number(rows[0]?.released) !== 1) throw new Error('INSTAGRAM_ADVISORY_LOCK_RELEASE_FAILED')
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * Atomically admits one task for a target and keeps a connection-level lock
 * alive for the entire task. MySQL releases the lock if the worker process or
 * its connection dies, so maintenance can distinguish a live session from an
 * expired heartbeat. The lease row still fences all actual writes.
 */
export async function withInstagramWorkerAdmission<T>(
  db: PrismaClient,
  target: string,
  operation: () => Promise<T>,
  options: { transactionTimeoutMs?: number } = {},
): Promise<T> {
  const names = lockNames(target)
  const transactionTimeoutMs = options.transactionTimeoutMs ?? DEFAULT_WORKER_TRANSACTION_TIMEOUT_MS
  if (!Number.isSafeInteger(transactionTimeoutMs) || transactionTimeoutMs < 1_000) throw new TypeError('INVALID_WORKER_TRANSACTION_TIMEOUT')

  return db.$transaction(async (session) => {
    let admissionHeld = false
    let activeHeld = false
    try {
      admissionHeld = await tryAcquireLock(session, names.admission)
      if (!admissionHeld) throw new InstagramAdmissionUnavailableError()

      const hold = await session.siteSetting.findUnique({ where: { key: holdKey(target) }, select: { value: true } })
      if (hold && hold.value !== 'RELEASED') throw new InstagramAdmissionUnavailableError()

      activeHeld = await tryAcquireLock(session, names.active)
      if (!activeHeld) throw new InstagramAdmissionUnavailableError()

      await releaseLock(session, names.admission)
      admissionHeld = false
      return await operation()
    } finally {
      if (activeHeld) await releaseLock(session, names.active)
      if (admissionHeld) await releaseLock(session, names.admission)
    }
  }, {
    maxWait: 5_000,
    timeout: transactionTimeoutMs,
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  })
}

/**
 * Blocks new admissions, waits for the live worker session to release its
 * active-task lock, then fences any orphaned (expired) lease before allowing a
 * migration or other maintenance operation. Any database error or timeout
 * rejects the operation, which makes the caller fail closed.
 */
export async function withInstagramMaintenanceDrain<T>(
  db: PrismaClient,
  target: string,
  operation: () => Promise<T>,
  options: { timeoutMs?: number; pollMs?: number; allowLegacyLeaseSchema?: boolean } = {},
): Promise<T> {
  const names = lockNames(target)
  const timeoutMs = options.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
  const pollMs = options.pollMs ?? DEFAULT_DRAIN_POLL_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) throw new TypeError('INVALID_MAINTENANCE_DRAIN_TIMEOUT')
  if (!Number.isSafeInteger(pollMs) || pollMs < 10) throw new TypeError('INVALID_MAINTENANCE_POLL_INTERVAL')

  return db.$transaction(async (session) => {
    const deadline = Date.now() + timeoutMs
    let admissionHeld = false
    let activeHeld = false
    try {
      while (!admissionHeld && Date.now() < deadline) {
        admissionHeld = await tryAcquireLock(session, names.admission)
        if (!admissionHeld) await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())))
      }
      if (!admissionHeld) throw new InstagramMaintenanceDrainTimeoutError()

      // Commit the shared hold on a separate pool connection while this
      // interactive transaction retains the session-level admission lock.
      // If this process dies during drain or migration, the committed row
      // keeps new workers out after MySQL releases its advisory lock.
      await db.siteSetting.upsert({
        where: { key: holdKey(target) },
        update: { value: 'HELD', valueType: 'TEXT', group: 'system', label: 'Instagram worker maintenance hold' },
        create: { key: holdKey(target), value: 'HELD', valueType: 'TEXT', group: 'system', label: 'Instagram worker maintenance hold' },
      })

      while (!activeHeld && Date.now() < deadline) {
        activeHeld = await tryAcquireLock(session, names.active)
        if (!activeHeld) await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())))
      }
      if (!activeHeld) throw new InstagramMaintenanceDrainTimeoutError()

      // Fence in short, independently committed statements. The transaction
      // that retains the session advisory lock must not keep a SocialSyncState
      // metadata or row lock across Prisma migrations/DDL.
      const generationColumnBefore = await hasLeaseGenerationColumn(db)
      if (!generationColumnBefore && !options.allowLegacyLeaseSchema) {
        throw new Error('INSTAGRAM_LEASE_GENERATION_SCHEMA_MISSING')
      }
      if (generationColumnBefore) await fenceExpiredLease(db, target, deadline, pollMs)
      const result = await operation()
      // The first expand deployment may add this column inside `operation`.
      // Keep the persistent hold and shared locks until the expanded schema is
      // confirmed and every orphaned generation has been fenced.
      if (!await hasLeaseGenerationColumn(db)) throw new Error('INSTAGRAM_LEASE_GENERATION_SCHEMA_MISSING_AFTER_MAINTENANCE')
      await fenceExpiredLease(db, target, deadline, pollMs)
      // Clear only after every maintenance operation has succeeded. Failure to
      // clear leaves a fail-closed hold for an operator or a later retry.
      await db.siteSetting.update({ where: { key: holdKey(target) }, data: { value: 'RELEASED' } })
      return result
    } finally {
      if (activeHeld) await releaseLock(session, names.active)
      if (admissionHeld) await releaseLock(session, names.admission)
    }
  }, {
    maxWait: Math.min(5_000, timeoutMs),
    timeout: timeoutMs + 5_000,
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  })
}

async function fenceExpiredLease(db: PrismaClient, target: string, deadline: number, pollMs: number) {
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<Array<{ lockToken: string | null; lockUntil: Date | null; expired: number | bigint | null }>>`
      SELECT lockToken, lockUntil,
        CASE WHEN lockUntil IS NOT NULL AND lockUntil <= UTC_TIMESTAMP(3) THEN 1 ELSE 0 END AS expired
      FROM SocialSyncState
      WHERE platform = 'INSTAGRAM' AND target = ${target}
      LIMIT 1
    `
    const state = rows[0]
    if (!state || (state.lockToken === null && state.lockUntil === null)) return
    if (!state.lockToken || !state.lockUntil) throw new InstagramLeaseStateInconsistentError()

    if (Number(state.expired) === 1) {
      const changed = await db.$executeRaw`
        UPDATE SocialSyncState
        SET leaseGeneration = leaseGeneration + 1, lockToken = NULL, lockUntil = NULL
        WHERE platform = 'INSTAGRAM' AND target = ${target}
          AND lockToken = ${state.lockToken} AND lockUntil <= UTC_TIMESTAMP(3)
      `
      if (Number(changed) === 1) return
      continue
    }

    const waitRows = await db.$queryRaw<Array<{ remainingMs: number | bigint | null }>>`
      SELECT GREATEST(1, TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), lockUntil) DIV 1000) AS remainingMs
      FROM SocialSyncState
      WHERE platform = 'INSTAGRAM' AND target = ${target}
      LIMIT 1
    `
    const remaining = Number(waitRows[0]?.remainingMs)
    if (!Number.isFinite(remaining) || remaining < 1) throw new InstagramLeaseStateInconsistentError()
    await delay(Math.min(pollMs, remaining, Math.max(1, deadline - Date.now())))
  }
  throw new InstagramMaintenanceDrainTimeoutError()
}

async function hasLeaseGenerationColumn(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ present: number | bigint | null }>>`
    SELECT COUNT(*) AS present FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'SocialSyncState' AND COLUMN_NAME = 'leaseGeneration'
  `
  return Number(rows[0]?.present) === 1
}
