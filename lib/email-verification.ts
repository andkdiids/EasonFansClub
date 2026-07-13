import { createHash, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'

const EMAIL_TOKEN_TTL_MS = 1000 * 60 * 60 * 24
const RESEND_COOLDOWN_MS = 1000 * 60 * 10

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

export function buildEmailVerificationUrl(token: string) {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`
}

export async function canSendEmailVerification(email: string) {
  const since = new Date(Date.now() - RESEND_COOLDOWN_MS)
  const recent = await prisma.emailVerification.findFirst({
    where: { email, usedAt: null, createdAt: { gte: since } },
    select: { id: true },
  })
  return !recent
}

export async function createVerificationForUser(userId: string, email: string) {
  const token = createEmailVerificationToken()
  const tokenHash = hashEmailToken(token)
  await prisma.emailVerification.create({
    data: {
      userId,
      email,
      tokenHash,
      expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
    },
  })
  return { token, verificationUrl: buildEmailVerificationUrl(token) }
}

export async function sendVerificationEmail(email: string, verificationUrl: string) {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM || 'EasonFansClub <onboarding@resend.dev>'
  const subject = '验证你的私家E院邮箱'
  const text = `请点击下面的链接完成邮箱验证：\n\n${verificationUrl}\n\n链接 24 小时内有效，如果不是你本人操作，请忽略这封邮件。`

  if (!apiKey) {
    if (process.env.NODE_ENV !== 'production') {
      console.log('[email.verify.dev-link]', verificationUrl)
    }
    return { sent: false, reason: 'missing_resend_api_key' as const }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: email,
      subject,
      text,
      html: `<p>请点击下面的链接完成邮箱验证：</p><p><a href="${verificationUrl}">验证邮箱</a></p><p>链接 24 小时内有效，如果不是你本人操作，请忽略这封邮件。</p>`,
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`EMAIL_SEND_FAILED:${detail.slice(0, 120)}`)
  }

  return { sent: true as const }
}
