import { createMySqlAdvisoryLockName } from '@/lib/mysql-advisory-lock'
import { maskLoginAccount } from '@/lib/login-account'
import { getPhoneLookupVariants, DEFAULT_PHONE_COUNTRY, isSupportedPhoneCountry, normalizePhoneNumber, type PhoneCountryCode } from '@/lib/phone-number'
import { isValidEmail, normalizeEmail } from '@/lib/email-verification'

export type UserContactPatch = {
  email?: string | null
  phone?: string | null
  phoneCountry?: PhoneCountryCode
}

export type UserContactInput = {
  email?: unknown
  phone?: unknown
  phoneCountry?: unknown
}

export type UserContactValidationCode = 'CONTACT_NOT_PROVIDED' | 'INVALID_EMAIL' | 'INVALID_PHONE'

export class UserContactValidationError extends Error {
  constructor(readonly code: UserContactValidationCode, message: string) {
    super(message)
    this.name = 'UserContactValidationError'
  }
}

function hasOwn(value: object | null, key: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
}

/**
 * Normalize the two canonical contact fields before they enter User.
 * `undefined` means "leave this field unchanged"; an empty string explicitly
 * clears the field. Phone numbers are stored as E.164, while email is stored
 * trimmed and lower-cased.
 */
export function normalizeUserContactPatch(input: UserContactInput): UserContactPatch {
  const source = input && typeof input === 'object' ? input : null
  const emailProvided = hasOwn(source, 'email')
  const phoneProvided = hasOwn(source, 'phone')
  if (!emailProvided && !phoneProvided) {
    throw new UserContactValidationError('CONTACT_NOT_PROVIDED', '请至少提交手机号或邮箱')
  }

  const patch: UserContactPatch = {}
  if (emailProvided) {
    const email = normalizeEmail(input.email)
    if (email && !isValidEmail(email)) {
      throw new UserContactValidationError('INVALID_EMAIL', '请输入有效邮箱地址')
    }
    patch.email = email || null
  }

  if (phoneProvided) {
    const rawPhone = typeof input.phone === 'string' ? input.phone.trim() : String(input.phone ?? '').trim()
    if (!rawPhone) {
      patch.phone = null
    } else {
      const phoneCountry = isSupportedPhoneCountry(input.phoneCountry) ? input.phoneCountry : DEFAULT_PHONE_COUNTRY
      const normalized = normalizePhoneNumber(rawPhone, phoneCountry)
      if (!normalized) {
        throw new UserContactValidationError('INVALID_PHONE', '手机号格式不正确')
      }
      patch.phone = normalized.e164
      patch.phoneCountry = normalized.country
    }
  }

  return patch
}

export function canonicalEmailValue(value: unknown) {
  const email = normalizeEmail(value)
  return email || null
}

export function canonicalPhoneValue(value: unknown, country: PhoneCountryCode = DEFAULT_PHONE_COUNTRY) {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  if (!raw) return null
  return normalizePhoneNumber(raw, country)?.e164 || raw.replace(/\s+/g, '')
}

export function getUserContactAdvisoryLockNames(userId: string, patch: UserContactPatch) {
  return [
    createMySqlAdvisoryLockName('user-contact-user', userId),
    ...getContactAdvisoryLockNames(patch),
  ]
}

/** Registration and account updates share these lock namespaces so a contact
 * cannot pass an application-level duplicate check concurrently. */
export function getContactAdvisoryLockNames(patch: UserContactPatch) {
  const names: string[] = []
  if (patch.email) names.push(createMySqlAdvisoryLockName('user-contact-email', patch.email))
  if (patch.phone) {
    for (const phone of getPhoneLookupVariants(patch.phone, patch.phoneCountry || DEFAULT_PHONE_COUNTRY)) {
      names.push(createMySqlAdvisoryLockName('user-contact-phone', phone))
    }
  }
  return names
}

export function maskContactValue(value: string | null | undefined) {
  return value ? maskLoginAccount(value) : null
}
