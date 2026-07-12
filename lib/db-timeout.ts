export class DbTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`)
    this.name = 'DbTimeoutError'
  }
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
