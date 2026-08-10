import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'
import { type AdminPermissionKey, hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser, isAuthServiceUnavailableError, type SessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const SENSITIVE_WORD_CACHE_TTL_MS = 60_000

let sensitiveWordCache: { expiresAt: number; words: string[] } | null = null

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

async function getSensitiveWords() {
  const now = Date.now()
  if (sensitiveWordCache && sensitiveWordCache.expiresAt > now) {
    return sensitiveWordCache.words
  }

  const rows = await prisma.sensitiveWord.findMany({
    where: { isActive: true },
    select: { word: true },
  })
  const words = rows.map((item) => item.word).filter(Boolean)
  sensitiveWordCache = { words, expiresAt: now + SENSITIVE_WORD_CACHE_TTL_MS }
  return words
}

export async function filterSensitiveWords(content: string) {
  try {
    const words = await getSensitiveWords()

    return words.reduce((text, word) => {
      return text.replaceAll(word, '*'.repeat(Math.min(word.length, 6)))
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

function parseIPv4(value: string) {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null
  const octets = parts.map(Number)
  if (octets.some((octet) => octet < 0 || octet > 255)) return null
  return octets.join('.')
}

function parseIPv6(value: string) {
  let candidate = value.toLowerCase()
  const lastColon = candidate.lastIndexOf(':')
  const embeddedIPv4 = candidate.slice(lastColon + 1)
  const parsedIPv4 = embeddedIPv4.includes('.') ? parseIPv4(embeddedIPv4) : null
  if (embeddedIPv4.includes('.') && !parsedIPv4) return null
  if (parsedIPv4) {
    const octets = parsedIPv4.split('.').map(Number)
    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    candidate = `${candidate.slice(0, lastColon + 1)}${high}:${low}`
  }

  const compressionParts = candidate.split('::')
  if (compressionParts.length > 2) return null
  const hasCompression = compressionParts.length === 2
  const left = (hasCompression ? compressionParts[0] : candidate).split(':').filter(Boolean)
  const right = hasCompression ? compressionParts[1].split(':').filter(Boolean) : []
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null

  const missing = 8 - left.length - right.length
  if (hasCompression ? missing < 1 : missing !== 0) return null
  const groups = [
    ...left,
    ...(hasCompression ? Array.from({ length: missing }, () => '0') : []),
    ...right,
  ].map((part) => Number.parseInt(part, 16))
  if (groups.length !== 8) return null

  // Treat IPv4-mapped IPv6 addresses as their IPv4 form, so both headers
  // identify the same client consistently.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    return [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ].join('.')
  }

  let bestStart = -1
  let bestLength = 0
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== 0) {
      index += 1
      continue
    }
    const start = index
    while (index < groups.length && groups[index] === 0) index += 1
    const length = index - start
    if (length >= 2 && length > bestLength) {
      bestStart = start
      bestLength = length
    }
  }

  if (bestStart < 0) return groups.map((group) => group.toString(16)).join(':')
  const before = groups.slice(0, bestStart).map((group) => group.toString(16)).join(':')
  const after = groups.slice(bestStart + bestLength).map((group) => group.toString(16)).join(':')
  return `${before}::${after}`
}

export function normalizeIp(value: unknown) {
  if (typeof value !== 'string') return ''
  let candidate = value.trim().replace(/^"|"$/g, '')
  if (!candidate) return ''

  if (candidate.startsWith('[')) {
    const closingBracket = candidate.indexOf(']')
    if (closingBracket < 0) return ''
    candidate = candidate.slice(1, closingBracket)
  } else {
    const ipv4WithPort = candidate.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d{1,5}$/)
    if (ipv4WithPort) candidate = ipv4WithPort[1]
  }

  return parseIPv4(candidate) || (candidate.includes(':') ? parseIPv6(candidate) || '' : '')
}

function isLocalOrPrivateIp(value: string) {
  if (value === '0.0.0.0' || value === '127.0.0.1' || value === '::' || value === '::1') return true
  const ipv4 = value.split('.').map(Number)
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part))) {
    return ipv4[0] === 10
      || ipv4[0] === 127
      || (ipv4[0] === 169 && ipv4[1] === 254)
      || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
      || (ipv4[0] === 192 && ipv4[1] === 168)
  }
  const firstGroup = Number.parseInt(value.split(':')[0] || '0', 16)
  return (firstGroup >= 0xfc00 && firstGroup <= 0xfdff)
    || (firstGroup >= 0xfe80 && firstGroup <= 0xfebf)
}

export function getClientIp(request: Request) {
  const candidates = [
    request.headers.get('cf-connecting-ip'),
    request.headers.get('x-real-ip'),
    ...(request.headers.get('x-forwarded-for')?.split(',') || []),
  ]
  for (const candidate of candidates) {
    const normalized = normalizeIp(candidate)
    if (normalized && !isLocalOrPrivateIp(normalized)) return normalized
  }
  return 'unknown'
}

export async function containsSensitiveContent(content: string) {
  if (!content.trim()) return false
  try {
    const normalized = content.toLocaleLowerCase('zh-CN')
    const words = await getSensitiveWords()
    return words.some((word) => normalized.includes(word.toLocaleLowerCase('zh-CN')))
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
