import type { Prisma } from '@prisma/client'
import { hashToken } from '@/lib/tokens'

const MYSQL_ADVISORY_LOCK_TIMEOUT_SECONDS = 2

type LockDatabase = Pick<Prisma.TransactionClient, '$queryRaw'>

export function createMySqlAdvisoryLockName(scope: string, value: string) {
  return `${scope}:${hashToken(`${scope}:${value}`)}`.slice(0, 64)
}

export class MySqlAdvisoryLockBusyError extends Error {
  constructor(readonly lockName: string) {
    super('MySQL advisory lock is busy')
    this.name = 'MySqlAdvisoryLockBusyError'
  }
}

export async function withMySqlAdvisoryLocks<T>(
  database: LockDatabase,
  lockNames: readonly string[],
  operation: () => Promise<T>,
) {
  const names = Array.from(new Set(lockNames)).sort()
  const acquired: string[] = []

  try {
    for (const lockName of names) {
      const rows = await database.$queryRaw<Array<{ acquired: number | bigint | null }>>`
        SELECT GET_LOCK(${lockName}, ${MYSQL_ADVISORY_LOCK_TIMEOUT_SECONDS}) AS acquired
      `
      if (Number(rows[0]?.acquired) !== 1) throw new MySqlAdvisoryLockBusyError(lockName)
      acquired.push(lockName)
    }

    return await operation()
  } finally {
    for (const lockName of acquired.reverse()) {
      try {
        await database.$queryRaw`SELECT RELEASE_LOCK(${lockName}) AS released`
      } catch (error) {
        console.error('[mysql-advisory-lock] release failed', { lockName, error })
      }
    }
  }
}
