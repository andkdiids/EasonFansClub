import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import type { UserRole } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isCompleteActiveUser } from '@/lib/users'

export const authCookieName = 'eason_fans_session'

export type SessionUser = {
  id: string
  uid: number
  username: string
  nickname: string
  role: UserRole
}

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-before-production',
)

export async function createSessionToken(user: SessionUser) {
  return new SignJWT(user)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
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

export async function getCurrentUser() {
  const cookieStore = await cookies()
  const token = cookieStore.get(authCookieName)?.value
  const sessionUser = await verifySessionToken(token)
  if (!sessionUser) return null

  try {
    const user = await prisma.user.findFirst({
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
        role: true,
        status: true,
        isDeleted: true,
        profile: { select: { id: true } },
      },
    })

    if (!user || !isCompleteActiveUser(user)) {
      return null
    }

    return {
      id: user.id,
      uid: user.uid,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    }
  } catch {
    return null
  }
}

export function getSessionCookieOptions(request?: Request) {
  const forwardedProtocol = request?.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const requestUsesHttps = request
    ? forwardedProtocol
      ? forwardedProtocol === 'https'
      : new URL(request.url).protocol === 'https:'
    : false

  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: requestUsesHttps || process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  }
}
