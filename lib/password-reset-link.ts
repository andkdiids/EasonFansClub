import { createPlainToken, hashToken } from '@/lib/tokens'
import { buildPublicAbsoluteUrl } from '@/lib/url-safety'

export const PASSWORD_RESET_LINK_TTL_MS = 30 * 60 * 1000
export const PASSWORD_RESET_LINK_MESSAGE = '如果该邮箱已注册，我们会发送密码重置链接'

export function normalizePasswordResetEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

export function isValidPasswordResetEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function buildPasswordResetUrl(token: string) {
  return buildPublicAbsoluteUrl(`/reset-password?token=${encodeURIComponent(token)}`)
}

export function createPasswordResetLinkToken(now = new Date()) {
  const token = createPlainToken()
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_LINK_TTL_MS),
  }
}

export function isPasswordResetTokenUsable(
  record: { consumedAt: Date | null; expiresAt: Date },
  now = new Date(),
) {
  return record.consumedAt === null && record.expiresAt.getTime() > now.getTime()
}
