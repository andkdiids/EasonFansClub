import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'
import { type AdminPermissionKey, hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser, isAuthServiceUnavailableError, type SessionUser } from '@/lib/auth'
import { getClientIp } from '@/lib/client-ip'
import { containsBannedWord, getEnabledBannedWords } from '@/lib/content-moderation'
import { prisma } from '@/lib/prisma'

export { getClientIp, normalizeIp } from '@/lib/client-ip'

export type GuardResult =
  | { user: SessionUser; response: null }
  | { user: null; response: NextResponse }

export function isAdminRole(role: UserRole) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

/** A 401 reserved for a confirmed missing/invalid browser session. */
export function unauthenticatedResponse(message = '请先登录', headers?: HeadersInit, extra: Record<string, unknown> = {}) {
  const responseHeaders = new Headers(headers)
  if (!responseHeaders.has('Cache-Control')) responseHeaders.set('Cache-Control', 'private, no-store, max-age=0')
  return NextResponse.json({ ok: false, code: 'UNAUTHENTICATED', message, ...extra }, {
    status: 401,
    headers: responseHeaders,
  })
}

function forbiddenResponse(message: string) {
  return NextResponse.json({ ok: false, code: 'FORBIDDEN', message }, {
    status: 403,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

export async function requireUser(): Promise<GuardResult> {
  let user: SessionUser | null
  try {
    user = await getCurrentUser()
  } catch (error) {
    if (isAuthServiceUnavailableError(error)) {
      return {
        user: null,
        response: NextResponse.json({ ok: false, code: 'AUTH_SERVICE_UNAVAILABLE', message: '登录服务暂时不可用，请稍后再试' }, { status: 503 }),
      }
    }
    throw error
  }

  if (!user) {
    return {
      user: null,
      response: unauthenticatedResponse(),
    }
  }

  return { user, response: null }
}

export async function requireAdmin(permissionKey?: AdminPermissionKey): Promise<GuardResult> {
  const result = await requireUser()
  if (!result.user) return result

  const allowed = await hasAdminPermission(result.user, permissionKey)
  if (!allowed) {
    return {
      user: null,
      response: forbiddenResponse('当前管理员未获得此权限'),
    }
  }

  return result
}

export async function requireSuperAdmin(): Promise<GuardResult> {
  const result = await requireUser()
  if (!result.user) return result

  if (result.user.role !== 'SUPER_ADMIN') {
    return {
      user: null,
      response: forbiddenResponse('只有超级管理员可以执行此操作'),
    }
  }

  return result
}

export function sanitizeText(value: unknown, maxLength = 5000) {
  const bounded = String(value ?? '').slice(0, Math.max(maxLength * 2, maxLength))

  return bounded
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .trim()
    .slice(0, maxLength)
}

export async function filterSensitiveWords(content: string) {
  try {
    const words = await getEnabledBannedWords()

    return words.reduce((text, word) => {
      if (!word.word) return text
      return text.replaceAll(word.word, '*'.repeat(Math.min(word.word.length, 6)))
    }, content)
  } catch {
    return content
  }
}

export type RateLimitResult = {
  limited: boolean
  retryAfter?: number
}

type RateLimitDimension = {
  limit: number
  windowSeconds: number
}

export type ApiRateLimitPolicy = {
  endpoint: string
  ip?: RateLimitDimension
  user?: RateLimitDimension
  account?: { key: string; limit: number; windowSeconds: number }
}

let lastRateLimitPruneAt = 0

function normalizedWindowSeconds(windowSeconds: number) {
  return Math.max(1, Math.floor(Number.isFinite(windowSeconds) ? windowSeconds : 60))
}

export function getRateLimitBucketId(key: string, action: string, windowSeconds: number, now = new Date()) {
  const window = normalizedWindowSeconds(windowSeconds)
  const windowStart = Math.floor(now.getTime() / 1000 / window) * window
  return createHash('sha256')
    .update(`${key}\u0000${action}\u0000${windowStart}`)
    .digest('hex')
}

function getRateLimitBucketExpiry(windowSeconds: number, now = new Date()) {
  const window = normalizedWindowSeconds(windowSeconds)
  const windowStart = Math.floor(now.getTime() / 1000 / window) * window
  return new Date((windowStart + window) * 1000)
}

async function pruneExpiredRateLimits(now: Date) {
  if (now.getTime() - lastRateLimitPruneAt < 60_000) return
  lastRateLimitPruneAt = now.getTime()
  await prisma.rateLimitLog.deleteMany({
    where: { expiresAt: { lt: now } },
  })
}

async function getRateLimitBucket(key: string, action: string, windowSeconds: number, now: Date) {
  return prisma.rateLimitLog.findUnique({
    where: { id: getRateLimitBucketId(key, action, windowSeconds, now) },
    select: { count: true, expiresAt: true },
  })
}

async function getRetryAfterSeconds(key: string, action: string, windowSeconds: number, now: Date) {
  const bucket = await getRateLimitBucket(key, action, windowSeconds, now)
  if (!bucket || bucket.expiresAt <= now) return undefined
  return Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000))
}

export async function checkRateLimit(
  key: string,
  action: string,
  limit = 30,
  windowSeconds = 30 * 60,
): Promise<RateLimitResult> {
  const now = new Date()

  try {
    void pruneExpiredRateLimits(now).catch(() => undefined)
    const bucket = await getRateLimitBucket(key, action, windowSeconds, now)
    if (bucket && bucket.expiresAt > now && bucket.count >= limit) {
      return {
        limited: true,
        retryAfter: await getRetryAfterSeconds(key, action, windowSeconds, now),
      }
    }
  } catch {
    return { limited: false }
  }

  return { limited: false }
}

export async function recordRateLimitHit(key: string, action: string, windowSeconds = 60) {
  const now = new Date()
  const window = normalizedWindowSeconds(windowSeconds)
  const id = getRateLimitBucketId(key, action, window, now)
  const expiresAt = getRateLimitBucketExpiry(window, now)

  try {
    void pruneExpiredRateLimits(now).catch(() => undefined)
    await prisma.rateLimitLog.upsert({
      where: { id },
      update: { count: { increment: 1 } },
      create: { id, key, action, count: 1, expiresAt },
    })
  } catch {
    return null
  }

  return null
}

export async function consumeRateLimit(key: string, action: string, limit = 30, windowSeconds = 60): Promise<RateLimitResult> {
  const now = new Date()
  const window = normalizedWindowSeconds(windowSeconds)
  const id = getRateLimitBucketId(key, action, window, now)
  const expiresAt = getRateLimitBucketExpiry(window, now)

  try {
    void pruneExpiredRateLimits(now).catch(() => undefined)
    const bucket = await prisma.rateLimitLog.upsert({
      where: { id },
      update: { count: { increment: 1 } },
      create: { id, key, action, count: 1, expiresAt },
      select: { count: true, expiresAt: true },
    })
    if (bucket.count > limit) {
      return {
        limited: true,
        retryAfter: Math.max(1, Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000)),
      }
    }
  } catch {
    // Rate limiting must not turn a database incident into a site-wide outage.
    return { limited: false }
  }

  return { limited: false }
}

export async function rateLimit(key: string, action: string, limit = 30, windowSeconds = 60) {
  const status = await consumeRateLimit(key, action, limit, windowSeconds)
  if (!status.limited) return null

  return NextResponse.json(
    { message: '操作过于频繁，请稍后再试', retryAfter: status.retryAfter },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(status.retryAfter || 1),
      },
    },
  )
}

export async function consumeApiRateLimits(
  request: Request,
  userId: string | null | undefined,
  policy: ApiRateLimitPolicy,
) {
  const action = `api:${request.method.toUpperCase()}:${policy.endpoint}`
  const dimensions: Array<{ key: string; limit: number; windowSeconds: number }> = []
  if (policy.ip) dimensions.push({ key: `ip:${getClientIp(request)}`, ...policy.ip })
  if (policy.user && userId) dimensions.push({ key: `user:${userId}`, ...policy.user })
  if (policy.account) {
    dimensions.push({
      key: `account:${policy.account.key}`,
      limit: policy.account.limit,
      windowSeconds: policy.account.windowSeconds,
    })
  }

  for (const dimension of dimensions) {
    const result = await consumeRateLimit(dimension.key, action, dimension.limit, dimension.windowSeconds)
    if (result.limited) return result
  }
  return { limited: false } satisfies RateLimitResult
}

export function rateLimitResponse(result: RateLimitResult, message = '操作过于频繁，请稍后再试') {
  return NextResponse.json(
    { ok: false, code: 'RATE_LIMITED', message, retryAfter: result.retryAfter },
    {
      status: 429,
      headers: {
        'Cache-Control': 'no-store',
        'Retry-After': String(result.retryAfter || 1),
      },
    },
  )
}

export async function logSecurityAbuse(
  request: Request,
  input: { endpoint: string; userId?: string | null; reason: string },
) {
  const ipAddress = getClientIp(request)
  const userAgent = request.headers.get('user-agent')?.slice(0, 255) || null
  const metadata = {
    endpoint: input.endpoint.slice(0, 120),
    method: request.method.toUpperCase(),
    reason: input.reason.slice(0, 120),
  }

  if (input.userId) {
    await prisma.accountSecurityLog.create({
      data: { userId: input.userId, action: 'API_ABUSE_RATE_LIMIT', ipAddress, userAgent, metadata },
    }).catch(() => undefined)
  }

  console.warn('[security.rate-limit]', JSON.stringify({ ...metadata, userId: input.userId || undefined, ipAddress }))
}

export async function enforceApiRateLimit(
  request: Request,
  userId: string | null | undefined,
  policy: ApiRateLimitPolicy,
  message = '操作过于频繁，请稍后再试',
) {
  const result = await consumeApiRateLimits(request, userId, policy)
  if (!result.limited) return null
  await logSecurityAbuse(request, { endpoint: policy.endpoint, userId, reason: 'rate_limit_exceeded' })
  return rateLimitResponse(result, message)
}

export async function containsSensitiveContent(content: string) {
  if (!content.trim()) return false
  try {
    return await containsBannedWord(content)
  } catch {
    return false
  }
}

const productionAllowedOrigins = [
  'http://43.138.254.68',
  'https://ecfc.fans',
]
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? productionAllowedOrigins
  : [...productionAllowedOrigins, 'http://localhost:3000', 'http://localhost:8000']

export function hasValidRequestOrigin(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') return false
  if (fetchSite === 'same-origin') return true
  const source = request.headers.get('origin') || request.headers.get('referer')
  // Origin is a CSRF signal, never an authentication factor. Native clients
  // and WebSocket libraries commonly omit it; explicit cross-site browser
  // requests are still rejected by the middleware/Fetch Metadata checks.
  if (!source) return true
  try {
    const sourceOrigin = new URL(source).origin
    const requestOrigin = new URL(request.url).origin
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
    const forwardedProtocol = request.headers.get('x-forwarded-proto')

    return (
      allowedOrigins.includes(sourceOrigin) ||
      sourceOrigin === requestOrigin ||
      Boolean(host && forwardedProtocol && sourceOrigin === `${forwardedProtocol}://${host}`) ||
      sourceOrigin === `http://${host}` ||
      sourceOrigin === `https://${host}`
    )
  } catch {
    return false
  }
}

export function rejectInvalidRequestOrigin(request: Request) {
  if (hasValidRequestOrigin(request)) return null
  return NextResponse.json({ message: '请求来源校验失败，请刷新页面后重试' }, { status: 403 })
}
