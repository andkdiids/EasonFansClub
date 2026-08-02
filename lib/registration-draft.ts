import { randomInt } from 'node:crypto'
import { hashToken } from '@/lib/tokens'

export const REGISTRATION_DRAFT_TTL_MS = 30 * 60 * 1000
export const REGISTRATION_CODE_TTL_MS = 10 * 60 * 1000

export type RegistrationVerificationChannel = 'EMAIL'

export function createRegistrationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashRegistrationCode(
  draftToken: string,
  channel: RegistrationVerificationChannel,
  code: string,
) {
  return hashToken(`${draftToken}:${channel}:${code}`)
}

export function getRegistrationIdentityHash(email: string, phone: string) {
  return hashToken(`${email.trim().toLowerCase()}:${phone.trim()}`)
}

export function normalizeRegistrationCode(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, '')
}
