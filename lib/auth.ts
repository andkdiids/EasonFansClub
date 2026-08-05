import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import type { UserRole } from '@prisma/client'
import { measureBootstrap } from '@/lib/bootstrap-timing'
import { withDbTimeout } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'
import { isCompleteActiveUser } from '@/lib/users'

export const authCookieName = 'eason_fans_session'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const authCookieDomain = '.ecfc.fans'

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
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
    if (typeof payload.id !== 'string' || !payload.id.trim()) return null
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

function getRequestHostname(request?: Request) {
  if (!request) return ''

  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const hostHeader = request.headers.get('host')?.split(',')[0]?.trim()
  const hostCandidate = forwardedHost || hostHeader

  if (hostCandidate) {
    try {
      return new URL(`http://${hostCandidate}`).hostname.toLowerCase()
    } catch {
      // Fall back to the URL below when a proxy sends a malformed host value.
    }
  }

  try {
    return new URL(request.url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export function getSessionCookieOptions(request?: Request) {
  const forwardedProtocol = request?.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const requestUsesHttps = request
    ? forwardedProtocol
      ? forwardedProtocol === 'https'
      : new URL(request.url).protocol === 'https:'
    : false

  const hostname = getRequestHostname(request)
  const localHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]'
  // 关键修复（移动端 / 微信无法保持登录）：只要请求经由 HTTPS 到达——无论 NODE_ENV 是否为 production，
  // 含 Cloudflare / 腾讯云反代转发的 x-forwarded-proto=https——会话 Cookie 就必须带 Secure + SameSite=None。
  // 旧逻辑仅在 NODE_ENV==='production' 时强制 secure=true，否则依赖 requestUsesHttps && COOKIE_SECURE==='true'；
  // 若部署环境未设 NODE_ENV='production' 或 COOKIE_SECURE，HTTPS 请求会生成 Secure=false / SameSite=Lax 的 Cookie，
  // 这正是 iOS / 微信 WebView 在「关闭页面重开」后丢弃会话、需要重新登录的根因。localhost 仍保持 host-only、
  // 非 Secure、Lax（开发友好，且 localhost 不允许设置 Domain）。
  const secure = localHost ? false : process.env.NODE_ENV === 'production' || requestUsesHttps
  // 微信内置浏览器（iOS WKWebView / Android X5）关闭网页重开后常丢弃 SameSite=Lax 的会话
  // Cookie，导致需要重新登录。改用 SameSite=None 并配合 Secure（HTTPS 下 secure 恒为 true），
  // 既保持跨浏览器/WebView 持久登录，又不降低安全性：HttpOnly 与 Secure 不变，仅放宽跨站发送策略。
  const sameSite = secure ? ('none' as const) : ('lax' as const)
  // Domain 固定为 .ecfc.fans：历史上依据 request host 匹配判定 Domain，会在非 ecfc.fans 的 host 下
  // 写入 host-only Cookie；它与 Domain=.ecfc.fans 的正常 Cookie 同名并存，退出时只删 domain 版、
  // 残留 host-only 版，表现为「退出登录无效」。现改为：仅 localhost 保持 host-only（localhost 不允许
  // 设置 Domain），其余 host（含 ecfc.fans / www.ecfc.fans / 生产任意 host）一律 .ecfc.fans，使 set/delete 永远一致。
  const domain = localHost ? undefined : authCookieDomain

  return {
    httpOnly: true,
    sameSite,
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
