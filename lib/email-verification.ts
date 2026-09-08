import { createHash, randomBytes, randomInt } from 'node:crypto'
import { sendEmailVerificationCode, verificationMailTemplate, sendMail } from '@/lib/mail'
import { prisma } from '@/lib/prisma'
import { buildPublicAbsoluteUrl } from '@/lib/url-safety'

const EMAIL_TOKEN_TTL_MS = 1000 * 60 * 60 * 24
const RESEND_COOLDOWN_MS = 1000 * 60
export const EMAIL_CODE_TTL_MS = 1000 * 60 * 10
export const EMAIL_CODE_RESEND_COOLDOWN_MS = 1000 * 60

export function normalizeEmail(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function hashEmailToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createEmailVerificationToken() {
  return randomBytes(32).toString('base64url')
}

export function createEmailVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/**
 * Profile binding codes deliberately use a different hash domain from link
 * tokens and password-reset codes. The target user and target email are part
 * of the value, so a code cannot be moved to another account or address.
 */
export function hashProfileEmailVerificationCode(userId: string, email: string, code: string) {
  return hashEmailToken(`PROFILE_EMAIL_CODE:${userId}:${email}:${code}`)
}

export function buildEmailVerificationUrl(token: string) {
  return buildPublicAbsoluteUrl(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
}

export async function canSendEmailVerification(email: string) {
  const since = new Date(Date.now() - RESEND_COOLDOWN_MS)
  const recent = await prisma.emailVerification.findFirst({
    where: { email, usedAt: null, createdAt: { gte: since } },
    select: { id: true },
  })
  return !recent
}

export async function canSendProfileEmailVerificationCode(userId: string, email: string) {
  const since = new Date(Date.now() - EMAIL_CODE_RESEND_COOLDOWN_MS)
  const recent = await prisma.emailVerification.findFirst({
    where: { userId, email, usedAt: null, createdAt: { gte: since } },
    select: { id: true },
  })
  return !recent
}

export async function createProfileEmailVerificationCode(userId: string, email: string) {
  const code = createEmailVerificationCode()
  const expiresAt = new Date(Date.now() + EMAIL_CODE_TTL_MS)
  await prisma.$transaction(async (tx) => {
    await tx.emailVerification.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    })
    await tx.emailVerification.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    })
    await tx.emailVerification.create({
      data: {
        userId,
        email,
        tokenHash: hashProfileEmailVerificationCode(userId, email, code),
        expiresAt,
      },
    })
  })
  return { code, expiresAt }
}

export async function sendProfileEmailVerificationCode(email: string, code: string) {
  return sendEmailVerificationCode(email, code, 'change-email')
}

export async function createVerificationForUser(userId: string, email: string) {
  const token = createEmailVerificationToken()
  const tokenHash = hashEmailToken(token)
  await prisma.$transaction(async (tx) => {
    await tx.emailVerification.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    })
    await tx.emailVerification.updateMany({
      where: { email, usedAt: null },
      data: { usedAt: new Date() },
    })
    await tx.emailVerification.create({
      data: {
        userId,
        email,
        tokenHash,
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    })
  })
  return { token, verificationUrl: buildEmailVerificationUrl(token) }
}

export async function sendVerificationEmail(
  email: string,
  verificationUrl: string,
  reason: 'register' | 'change-email' | 'resend' = 'register',
) {
  return sendMail({
    to: email,
    subject: reason === 'change-email' ? '验证你的新邮箱 - 私家E院' : '验证你的私家E院邮箱',
    template: verificationMailTemplate(verificationUrl, reason),
  })
}
