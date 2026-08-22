import { cookies } from 'next/headers'
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose'
import type { UserRole } from '@prisma/client'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { withDbTimeout } from '@/lib/db-timeout'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { isCompleteActiveUser } from '@/lib/users'
import { authCookieName, SESSION_MAX_AGE_SECONDS } from '@/lib/auth-cookie'
import { publicModerationUserName } from '@/lib/content-moderation'
import { getEquippedBadgeForUser } from '@/lib/badge-service'
import type { EquippedBadgeView } from '@/lib/badge-types'

export { authCookieName, SESSION_MAX_AGE_SECONDS } from '@/lib/auth-cookie'

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
  equippedBadge?: EquippedBadgeView | null
}

export type SessionShellUser = Pick<SessionUser, 'id' | 'uid' | 'nickname' | 'avatarUrl' | 'equippedBadge'>

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
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    if (typeof payload.id !== 'string' || !payload.id.trim()) return null
    return payload as SessionUser
  } catch (error) {
    // Expired/malformed/signature-invalid JWTs are ordinary unauthenticated
    // states. An unexpected non-JOSE failure is an auth-service failure and
    // must not be collapsed into null, otherwise RSC guards can redirect a
    // valid user to /login during an internal verification outage.
    if (error instanceof joseErrors.JOSEError) return null
    console.error('[auth.session.verify]', {
      errorName: error instanceof Error ? error.name : 'unknown',
    })
    throw new AuthServiceUnavailableError('Authentication token verification failed', { cause: error })
  }
}

async function getSessionUsersFromCookie() {
  const cookieStore = await cookies()
  // Domain=.ecfc.fans and historical host-only cookies can coexist after a
  // host migration or an interrupted rolling refresh. Match middleware: test
  // every same-name cookie instead of trusting whichever one get() returns.
  const tokens = cookieStore.getAll(authCookieName).map((cookie) => cookie.value)
  const users: SessionUser[] = []
  for (const token of tokens) {
    const user = await verifySessionToken(token)
    if (user) users.push(user)
  }
  return users
}

export async function getSessionUserFromCookie() {
  return (await getSessionUsersFromCookie())[0] || null
}

async function getCurrentUserForSessionUser(sessionUser: SessionUser | null) {
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
            usernameModerationStatus: true,
            nicknameModerationStatus: true,

            nicknameViolationDisplay: true,
            Profile: { select: { id: true, avatarUrl: true, displayName: true, displayNameModerationStatus: true } },
          },
        }),
        8000,
      ),
    ).then(async (user) => {
      if (!user || !isCompleteActiveUser(user)) return null
      const equippedBadge = await getEquippedBadgeForUser(user.id).catch(() => null)

      return {
        id: user.id,
        uid: user.uid,
        username: publicModerationUserName(user.username, [user.usernameModerationStatus]),
        nickname: getPublicUserDisplayName(user),
        avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl),
        level: user.level,
        experience: user.experience,
        role: user.role,
        canPlayFullMusic: user.canPlayFullMusic,
        equippedBadge,
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

/**
 * Resolve a session token outside a Next request context, such as the custom
 * Node WebSocket upgrade handler. The token is only the first step: the user
 * is looked up again so deleted, disabled, or otherwise inactive accounts are
 * rejected before a realtime connection is bound to an id.
 */
export async function getCurrentUserFromSessionToken(token?: string) {
  return getCurrentUserForSessionUser(await verifySessionToken(token))
}

export async function getCurrentUser() {
  const sessionUsers = await getSessionUsersFromCookie()
  for (const sessionUser of sessionUsers) {
    const user = await getCurrentUserForSessionUser(sessionUser)
    if (user) return user
  }
  if (sessionUsers.length) {
    // A cryptographically valid JWT whose account is missing/inactive is a
    // real session invalidation, distinct from a database outage (which has
    // already thrown AuthServiceUnavailableError above).
    console.warn('[AUTH_SESSION_INVALID]', JSON.stringify({
      reason: 'SESSION_USER_NOT_FOUND',
      source: 'server-auth',
      hasSessionCookie: true,
      tokenStatus: 'VALID',
      userId: sessionUsers[0]?.id,
      at: new Date().toISOString(),
    }))
  }
  return null
}

export { getSessionCookieOptions, getSessionCookieDeletionOptions } from '@/lib/auth-cookie'
