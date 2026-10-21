import { createHash } from 'node:crypto'

export type AtomicRateLimitUpsertInput = {
  where: { id: string }
  update: { count: { increment: 1 } }
  create: { id: string; key: string; action: string; count: 1; expiresAt: Date }
  select: { count: true; expiresAt: true }
}

export type AtomicRateLimitStore = {
  upsert: (input: AtomicRateLimitUpsertInput) => Promise<{ count: number; expiresAt: Date }>
}

export type AtomicRateLimitResult = { limited: boolean; retryAfter?: number }

export class RateLimitUnavailableError extends Error {
  constructor() {
    super('Password security rate limiting is unavailable')
    this.name = 'RateLimitUnavailableError'
  }
}

export async function consumeRateLimitFailClosed(
  store: AtomicRateLimitStore,
  key: string,
  action: string,
  limit: number,
  windowSeconds: number,
  now = new Date(),
): Promise<AtomicRateLimitResult> {
  const window = Math.max(1, Math.floor(Number.isFinite(windowSeconds) ? windowSeconds : 60))
  const windowStart = Math.floor(now.getTime() / 1000 / window) * window
  const id = createHash('sha256').update(`${key}\u0000${action}\u0000${windowStart}`).digest('hex')
  const expiresAt = new Date((windowStart + window) * 1000)

  let bucket: { count: number; expiresAt: Date }
  try {
    bucket = await store.upsert({
      where: { id },
      update: { count: { increment: 1 } },
      create: { id, key, action, count: 1, expiresAt },
      select: { count: true, expiresAt: true },
    })
  } catch {
    // Password-changing endpoints must not become unlimited when the limiter
    // store is unavailable. Deliberately omit the underlying error and cause.
    throw new RateLimitUnavailableError()
  }

  if (bucket.count <= limit) return { limited: false }
  return {
    limited: true,
    retryAfter: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000)),
  }
}
