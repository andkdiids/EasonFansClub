import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'
import { type AdminPermissionKey, hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser, isAuthServiceUnavailableError, type SessionUser } from '@/lib/auth'
import { containsBannedWord, getEnabledBannedWords } from '@/lib/content-moderation'
import { prisma } from '@/lib/prisma'

export { getClientIp, normalizeIp } from '@/lib/client-ip'

export type GuardResult =
  | { user: SessionUser; response: null }
  | { user: null; response: NextResponse }

export function isAdminRole(role: UserRole) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export async function requireUser(): Promise<GuardResult> {
  let user: SessionUser | null
  try {
    user = await getCurrentUser()
  } catch (error) {
    if (isAuthServiceUnavailableError(error)) {
      return {
        user: null,
        response: NextResponse.json({ message: '登录服务暂时不可用，请稍后再试' }, { status: 503 }),
      }
    }
    throw error
  }

  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ ok: false, code: 'UNAUTHORIZED', message: '请先登录' }, { status: 401 }),
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
      response: NextResponse.json({ message: '当前管理员未获得此权限' }, { status: 403 }),
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
      response: NextResponse.json({ message: '只有超级管理员可以执行此操作' }, { status: 403 }),
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

async function pruneExpiredRateLimits(now: Date) {
  await prisma.rateLimitLog.deleteMany({
    where: { expiresAt: { lt: now } },
  })
}

async function getRetryAfterSeconds(key: string, action: string, now: Date) {
  const oldestActive = await prisma.rateLimitLog.aggregate({
    where: { key, action, expiresAt: { gt: now } },
    _min: { expiresAt: true },
  })
  const resetAt = oldestActive._min.expiresAt
  if (!resetAt) return undefined
  return Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))
}

export async function checkRateLimit(key: string, action: string, limit = 30): Promise<RateLimitResult> {
  const now = new Date()

  try {
    await pruneExpiredRateLimits(now)

    const count = await prisma.rateLimitLog.count({
      where: { key, action, expiresAt: { gt: now } },
    })

    if (count >= limit) {
      return { limited: true, retryAfter: await getRetryAfterSeconds(key, action, now) }
    }
  } catch {
    return { limited: false }
  }

  return { limited: false }
}

export async function recordRateLimitHit(key: string, action: string, windowSeconds = 60) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000)

  try {
    await pruneExpiredRateLimits(now)
    await prisma.rateLimitLog.create({ data: { key, action, expiresAt } })
  } catch {
    return null
  }

  return null
}

export async function consumeRateLimit(key: string, action: string, limit = 30, windowSeconds = 60): Promise<RateLimitResult> {
  const status = await checkRateLimit(key, action, limit)
  if (status.limited) return status

  await recordRateLimitHit(key, action, windowSeconds)
  return { limited: false }
}

export async function rateLimit(key: string, action: string, limit = 30, windowSeconds = 60) {
  const status = await consumeRateLimit(key, action, limit, windowSeconds)
  if (!status.limited) return null

  return NextResponse.json(
    { message: '操作过于频繁，请稍后再试', retryAfter: status.retryAfter },
    { status: 429 },
  )
}

export async function containsSensitiveContent(content: string) {
  if (!content.trim()) return false
  try {
    return await containsBannedWord(content)
  } catch {
    return false
  }
}

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:8000',
  'http://43.138.254.68',
  'https://ecfc.fans',
]

export function hasValidRequestOrigin(request: Request) {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site' && fetchSite !== 'none') return false
  if (fetchSite === 'same-origin') return true
  const source = request.headers.get('origin') || request.headers.get('referer')
  if (!source) return process.env.NODE_ENV !== 'production'
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
