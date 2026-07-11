export class DbTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} timed out`)
    this.name = 'DbTimeoutError'
  }
}

export async function withDbTimeout<T>(label: string, operation: Promise<T>, timeoutMs = 4500) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new DbTimeoutError(label)), timeoutMs)
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
