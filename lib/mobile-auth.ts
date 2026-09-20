import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { errors as joseErrors, jwtVerify, SignJWT } from 'jose'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

export const MOBILE_ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const MOBILE_REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60
export const MOBILE_ACCESS_TOKEN_ISSUER = 'ecfc'
export const MOBILE_ACCESS_TOKEN_AUDIENCE = 'ecfc-mobile'
export const MOBILE_ACCESS_TOKEN_TYPE = 'mobile_access'

const mobileUserSelect = {
  id: true,
  uid: true,
  nickname: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  avatarUrl: true,
  Profile: { select: { avatarUrl: true } },
} satisfies Prisma.UserSelect

type MobileUserRecord = Prisma.UserGetPayload<{ select: typeof mobileUserSelect }>

export type MobileUserDto = {
  id: string
  uid: number
  nickname: string
  avatarUrl: string | null
}

export type MobileAccessClaims = {
  userId: string
  sessionId: string
}

export type MobileTokenResponse = {
  accessToken: string
  accessTokenExpiresAt: string
  refreshToken: string
  refreshTokenExpiresAt: string
  user?: MobileUserDto
}

export class MobileAuthConfigurationError extends Error {
  constructor() {
    super('Mobile authentication is not configured')
    this.name = 'MobileAuthConfigurationError'
  }
}

export class InvalidMobileRefreshTokenError extends Error {
  constructor() {
    super('Invalid mobile refresh token')
    this.name = 'InvalidMobileRefreshTokenError'
  }
}

function requireMobileAccessTokenSecret() {
  const value = process.env.MOBILE_ACCESS_TOKEN_SECRET?.trim()
  if (!value || value.length < 32) throw new MobileAuthConfigurationError()
  return new TextEncoder().encode(value)
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createRefreshToken() {
  return randomBytes(32).toString('base64url')
}

export function getBearerToken(authorization: string | null | undefined) {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)
  return match?.[1] || null
}

export async function createMobileAccessToken(userId: string, sessionId: string, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000)
  return new SignJWT({
    sid: sessionId,
    typ: MOBILE_ACCESS_TOKEN_TYPE,
    jti: randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(MOBILE_ACCESS_TOKEN_ISSUER)
    .setAudience(MOBILE_ACCESS_TOKEN_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + MOBILE_ACCESS_TOKEN_TTL_SECONDS)
    .sign(requireMobileAccessTokenSecret())
}

export async function verifyMobileAccessToken(token: string): Promise<MobileAccessClaims | null> {
  const secret = requireMobileAccessTokenSecret()
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: MOBILE_ACCESS_TOKEN_ISSUER,
      audience: MOBILE_ACCESS_TOKEN_AUDIENCE,
    })
    if (
      typeof payload.sub !== 'string' || !payload.sub.trim()
      || typeof payload.sid !== 'string' || !payload.sid.trim()
      || payload.typ !== MOBILE_ACCESS_TOKEN_TYPE
    ) return null
    return { userId: payload.sub, sessionId: payload.sid }
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) return null
    return null
  }
}

function toMobileUser(record: MobileUserRecord | null): MobileUserDto | null {
  if (!record || typeof record.uid !== 'number') return null
  return {
    id: record.id,
    uid: record.uid,
    nickname: getPublicUserDisplayName(record),
    avatarUrl: publicImageUrl(record.Profile?.avatarUrl || record.avatarUrl),
  }
}

export async function getMobileUserById(userId: string) {
  const record = await prisma.user.findFirst({
    where: { id: userId, isDeleted: false, status: 'ACTIVE' },
    select: mobileUserSelect,
  })
  return toMobileUser(record)
}

export async function issueMobileSession(user: MobileUserDto, now = new Date()): Promise<MobileTokenResponse> {
  // Validate configuration before creating a database row, so a missing
  // deployment secret cannot leave behind a session the client cannot use.
  const sessionId = randomUUID()
  const accessToken = await createMobileAccessToken(user.id, sessionId, now)
  const refreshToken = createRefreshToken()
  const refreshTokenExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_TOKEN_TTL_SECONDS * 1000)

  await prisma.mobileAuthSession.create({
    data: {
      id: sessionId,
      userId: user.id,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshTokenExpiresAt,
    },
  })

  return {
    accessToken,
    accessTokenExpiresAt: new Date(now.getTime() + MOBILE_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshToken,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
    user,
  }
}

type RefreshSessionRecord = {
  id: string
  userId: string
  expiresAt: Date
  revokedAt: Date | null
}

export type RefreshSessionStore = {
  findByRefreshTokenHash: (refreshTokenHash: string) => Promise<RefreshSessionRecord | null>
  updateRefreshToken: (input: {
    id: string
    expectedRefreshTokenHash: string
    refreshTokenHash: string
    expiresAt: Date
    lastUsedAt: Date
  }) => Promise<number>
}

/**
 * The compare-and-swap boundary used by refresh rotation. A concurrent caller
 * may read the same old hash, but only the first conditional update can
 * consume it; the second caller receives the same generic invalid-token path.
 */
export async function consumeMobileRefreshSession(
  store: RefreshSessionStore,
  input: { oldHash: string; newHash: string; now: Date; newExpiresAt: Date },
) {
  const session = await store.findByRefreshTokenHash(input.oldHash)
  if (!session || session.revokedAt || session.expiresAt <= input.now) throw new InvalidMobileRefreshTokenError()

  const updatedCount = await store.updateRefreshToken({
    id: session.id,
    expectedRefreshTokenHash: input.oldHash,
    refreshTokenHash: input.newHash,
    expiresAt: input.newExpiresAt,
    lastUsedAt: input.now,
  })
  if (updatedCount !== 1) throw new InvalidMobileRefreshTokenError()
  return session
}

export async function rotateMobileRefreshToken(refreshToken: string, now = new Date()): Promise<MobileTokenResponse> {
  if (!refreshToken.trim()) throw new InvalidMobileRefreshTokenError()
  // Fail before entering the transaction if the deployment is missing its
  // independent mobile signing secret.
  requireMobileAccessTokenSecret()

  const oldHash = hashRefreshToken(refreshToken)
  const nextRefreshToken = createRefreshToken()
  const nextHash = hashRefreshToken(nextRefreshToken)
  const nextExpiresAt = new Date(now.getTime() + MOBILE_REFRESH_TOKEN_TTL_SECONDS * 1000)

  const rotated = await prisma.$transaction(async (tx) => {
    const session = await consumeMobileRefreshSession({
      findByRefreshTokenHash: async (refreshTokenHash) => tx.mobileAuthSession.findUnique({
        where: { refreshTokenHash },
        select: { id: true, userId: true, expiresAt: true, revokedAt: true },
      }),
      updateRefreshToken: async (input) => {
        const result = await tx.mobileAuthSession.updateMany({
          where: {
            id: input.id,
            refreshTokenHash: input.expectedRefreshTokenHash,
            revokedAt: null,
            expiresAt: { gt: input.lastUsedAt },
          },
          data: {
            refreshTokenHash: input.refreshTokenHash,
            expiresAt: input.expiresAt,
            lastUsedAt: input.lastUsedAt,
            updatedAt: input.lastUsedAt,
          },
        })
        return result.count
      },
    }, { oldHash, newHash: nextHash, now, newExpiresAt: nextExpiresAt })

    const userRecord = await tx.user.findFirst({
      where: { id: session.userId, isDeleted: false, status: 'ACTIVE' },
      select: mobileUserSelect,
    })
    const user = toMobileUser(userRecord)
    if (!user) throw new InvalidMobileRefreshTokenError()
    return { sessionId: session.id, user }
  })

  const accessToken = await createMobileAccessToken(rotated.user.id, rotated.sessionId, now)
  return {
    accessToken,
    accessTokenExpiresAt: new Date(now.getTime() + MOBILE_ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshToken: nextRefreshToken,
    refreshTokenExpiresAt: nextExpiresAt.toISOString(),
  }
}

export async function resolveMobileAccess(request: Request) {
  const token = getBearerToken(request.headers.get('authorization'))
  if (!token) return null
  const claims = await verifyMobileAccessToken(token)
  if (!claims) return null

  const session = await prisma.mobileAuthSession.findFirst({
    where: {
      id: claims.sessionId,
      userId: claims.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { userId: true },
  })
  if (!session) return null
  const user = await getMobileUserById(session.userId)
  if (!user) return null
  return { claims, user }
}

export async function revokeMobileSession(input: { sessionId?: string | null; refreshToken?: string | null }) {
  const where: Prisma.MobileAuthSessionWhereInput = { revokedAt: null }
  if (input.sessionId) where.id = input.sessionId
  if (input.refreshToken) where.refreshTokenHash = hashRefreshToken(input.refreshToken)
  if (!input.sessionId && !input.refreshToken) return

  await prisma.mobileAuthSession.updateMany({
    where,
    data: { revokedAt: new Date() },
  })
}

export function isMobileAuthConfigurationError(error: unknown): error is MobileAuthConfigurationError {
  return error instanceof MobileAuthConfigurationError
}

export function isInvalidMobileRefreshTokenError(error: unknown): error is InvalidMobileRefreshTokenError {
  return error instanceof InvalidMobileRefreshTokenError
}
