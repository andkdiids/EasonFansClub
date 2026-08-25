export class DbTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`)
    this.name = 'DbTimeoutError'
  }
}

type DatabaseErrorLike = {
  code?: unknown
  message?: unknown
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const code = (error as DatabaseErrorLike).code
  return typeof code === 'string' || typeof code === 'number' ? String(code) : null
}

/**
 * Keep degraded reads deliberately narrow. A programming error must still
 * reach the caller; only a transient connection/pool failure may use a safe
 * product default.
 */
export function isRetryableDatabaseConnectionError(error: unknown) {
  if (error instanceof DbTimeoutError) return true

  const code = databaseErrorCode(error)
  if (code && ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) return true

  const message = error && typeof error === 'object' && typeof (error as DatabaseErrorLike).message === 'string'
    ? (error as DatabaseErrorLike).message as string
    : ''
  return /server has closed the connection|can't reach the database server|timed out fetching a new connection|connection (?:was )?(?:closed|reset|timed out)|connection refused|socket hang up/i.test(message)
}

function numberFromEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function effectiveDbTimeoutMs(timeoutMs: number) {
  const isVercelRuntime = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.VERCEL_URL)
  if (!isVercelRuntime) return timeoutMs

  return Math.max(timeoutMs, numberFromEnv('VERCEL_DB_TIMEOUT_MS', 6000))
}

export async function withDbTimeout<T>(label: string, operation: Promise<T>, timeoutMs = 4500) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const effectiveTimeoutMs = effectiveDbTimeoutMs(timeoutMs)
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DbTimeoutError(label)), effectiveTimeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function safeDb<T>(label: string, operation: Promise<T>, fallback: T, timeoutMs = 4500) {
  try {
    return await withDbTimeout(label, operation, timeoutMs)
  } catch (error) {
    console.error(`[db:${label}]`, error)
    return fallback
  }
}

/**
 * A no-retry, bounded fallback for secondary configuration reads. Not retrying
 * here is intentional: a request storm must not be amplified while the DB is
 * already unavailable. Unknown errors are rethrown instead of being hidden.
 */
export async function safeRetryableDbRead<T>(label: string, operation: Promise<T>, fallback: T, timeoutMs = 2500) {
  try {
    return await withDbTimeout(label, operation, timeoutMs)
  } catch (error) {
    if (!isRetryableDatabaseConnectionError(error)) throw error
    console.warn(`[db:${label}.degraded]`, {
      code: databaseErrorCode(error) || (error instanceof Error ? error.name : 'UNKNOWN'),
      fallback: true,
    })
    return fallback
  }
}
