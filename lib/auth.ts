import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import type { UserRole } from '@prisma/client'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import { withDbTimeout } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'
import { isCompleteActiveUser } from '@/lib/users'

export const authCookieName = 'eason_fans_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const authCookieDomain = 'ecfc.fans'

export type SessionUser = {
  id: string
  uid: number
  username: string
  nickname: string
  avatarUrl?: string | null
  level?: number
  experience?: number
  role: UserRole
  canPlayFullMusic?: boolean
}

export class AuthServiceUnavailableError extends Error {
  constructor(message = 'Authentication service is temporarily unavailable', options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthServiceUnavailableError'
  }
}

export function isAuthServiceUnavailableError(error: unknown) {
  return error instanceof AuthServiceUnavailableError
}

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-before-production',
)

const currentUserCacheTtlMs = Number(process.env.AUTH_USER_CACHE_TTL_MS || (process.env.NODE_ENV === 'production' ? 5000 : 15000))
const currentUserCache = new Map<string, { expiresAt: number; user: SessionUser | null; promise?: Promise<SessionUser | null> }>()

export function invalidateCurrentUserCache(userId: string) {
  currentUserCache.delete(userId)
}

export async function createSessionToken(user: SessionUser) {
  return new SignJWT(user)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secret)
}

export async function verifySessionToken(token?: string) {
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, secret)
    return payload as SessionUser
  } catch {
    return null
  }
}

export async function getSessionUserFromCookie() {
  const cookieStore = await cookies()
  const token = cookieStore.get(authCookieName)?.value
  return verifySessionToken(token)
}

export async function getCurrentUser() {
  const sessionUser = await getSessionUserFromCookie()

  if (!sessionUser) return null

  const now = Date.now()
  const cached = currentUserCache.get(sessionUser.id)
  if (cached && cached.expiresAt > now) {
    if (cached.promise) return cached.promise
    return cached.user
  }

  try {
    const lookup = measureBootstrap(
      'auth.currentUser',
      withDbTimeout(
        'auth.currentUser',
        prisma.user.findFirst({
          where: {
            id: sessionUser.id,
            isDeleted: false,
            status: 'ACTIVE',
          },
          select: {
            id: true,
            uid: true,
            username: true,
            nickname: true,
            avatarUrl: true,
            level: true,
            experience: true,
            role: true,
            canPlayFullMusic: true,
            status: true,
            isDeleted: true,
            Profile: { select: { id: true, avatarUrl: true } },
          },
        }),
        8000,
      ),
    ).then((user) => {
      if (!user || !isCompleteActiveUser(user)) return null

      return {
        id: user.id,
        uid: user.uid,
        username: user.username,
        nickname: user.nickname,
        avatarUrl: user.Profile?.avatarUrl || user.avatarUrl || null,
        level: user.level,
        experience: user.experience,
        role: user.role,
        canPlayFullMusic: user.canPlayFullMusic,
      }
    })

    currentUserCache.set(sessionUser.id, { expiresAt: now + currentUserCacheTtlMs, user: null, promise: lookup })
    const currentUser = await lookup
    currentUserCache.set(sessionUser.id, { expiresAt: Date.now() + currentUserCacheTtlMs, user: currentUser })

    return currentUser
  } catch (error) {
    currentUserCache.delete(sessionUser.id)
    console.error('[auth.currentUser]', error)
    throw new AuthServiceUnavailableError(undefined, { cause: error })
  }
}

export function getSessionCookieOptions(request?: Request) {
  const forwardedProtocol = request?.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const requestUsesHttps = request
    ? forwardedProtocol
      ? forwardedProtocol === 'https'
      : new URL(request.url).protocol === 'https:'
    : false

  const requestUrl = request ? new URL(request.url) : null
  const hostname = requestUrl?.hostname.toLowerCase() || ''
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  const secure = process.env.NODE_ENV === 'production'
    ? true
    : localHost
      ? false
      : requestUsesHttps && process.env.COOKIE_SECURE === 'true'
  const domain = hostname === authCookieDomain || hostname.endsWith(`.${authCookieDomain}`)
    ? authCookieDomain
    : undefined

  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    ...(domain ? { domain } : {}),
    maxAge: SESSION_MAX_AGE_SECONDS,
    expires: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
  }
}

export function getSessionCookieDeletionOptions(request?: Request) {
  return {
    ...getSessionCookieOptions(request),
    maxAge: 0,
    expires: new Date(0),
  }
}
