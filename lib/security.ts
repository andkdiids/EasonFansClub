import { NextResponse } from 'next/server'
import type { UserRole } from '@prisma/client'
import { type AdminPermissionKey, hasAdminPermission, isAdminUser } from '@/lib/admin-permissions'
import { getCurrentUser, isAuthServiceUnavailableError, type SessionUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const SENSITIVE_WORD_CACHE_TTL_MS = 60_000

let sensitiveWordCache: { expiresAt: number; words: string[] } | null = null

export type GuardResult =
  | { user: SessionUser; response: null }
  | { user: null; response: NextResponse }

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
      response: NextResponse.json({ message: '请先登录后再操作' }, { status: 401 }),
    }
  }

  return { user, response: null }
}

export function isAdminRole(role: UserRole) {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

export async function requireAdmin(permissionKey?: AdminPermissionKey): Promise<GuardResult> {
  const result = await requireUser()
  if (!result.user) return result

  if (!isAdminUser(result.user)) {
    return {
      user: null,
      response: NextResponse.json({ message: '只有管理员可以执行' }, { status: 403 }),
    }
  }

  const allowed = await hasAdminPermission(result.user, permissionKey)
  if (!allowed) {
    return {
      user: null,
      response: NextResponse.json({ message: '当前管理员未获得此权限' }, { status: 403 }),
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

export async function rateLimit(key: string, action: string, limit = 30, windowSeconds = 60) {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000)

  try {
    await prisma.rateLimitLog.deleteMany({
      where: { expiresAt: { lt: now } },
    })

    const count = await prisma.rateLimitLog.count({
      where: { key, action, expiresAt: { gt: now } },
    })

    if (count >= limit) {
      return NextResponse.json({ message: '操作过于频繁，请稍后再试' }, { status: 429 })
    }

    await prisma.rateLimitLog.create({ data: { key, action, expiresAt } })
  } catch {
    return null
  }

  return null
}

export function getClientIp(request: Request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  )
}
