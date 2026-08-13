import { randomInt } from 'node:crypto'
import { hashToken } from '@/lib/tokens'

export const REGISTRATION_DRAFT_TTL_MS = 30 * 60 * 1000
export const REGISTRATION_CODE_TTL_MS = 10 * 60 * 1000
// The colon deliberately makes the marker impossible for a real username,
// whose allowed character set is limited to Han characters, ASCII letters,
// digits and underscores.
export const HOSPITAL_ONLY_DRAFT_PREFIX = '__ehospital__:'

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

export function isHospitalOnlyDraft(value: unknown) {
  return typeof value === 'string' && value.startsWith(HOSPITAL_ONLY_DRAFT_PREFIX)
}

export function getHospitalOnlyDraftValues(identityHash: string) {
  const marker = `${HOSPITAL_ONLY_DRAFT_PREFIX}${hashToken(identityHash).slice(0, 16)}`
  return {
    username: marker,
    usernameNormalized: marker,
    nickname: marker,
    email: `${hashToken(`${marker}:email`).slice(0, 24)}@pending.invalid`,
    phone: '00000000000',
    identityHash,
  }
}

export function normalizeRegistrationCode(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, '')
}
