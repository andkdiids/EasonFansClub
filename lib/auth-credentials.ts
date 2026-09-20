import { DbTimeoutError, withDbTimeout } from '@/lib/db-timeout'
import { hashPassword, verifyPassword, type PasswordVerifyResult } from '@/lib/password'
import { DEFAULT_PHONE_COUNTRY, getPhoneValidationMessage, isSupportedPhoneCountry, normalizePhoneNumber, type PhoneCountryCode } from '@/lib/phone-number'
import { prisma } from '@/lib/prisma'
import { consumeApiRateLimits, getClientIp, logSecurityAbuse, type RateLimitResult } from '@/lib/security'
import { findCompleteUserByLoginIdentifier } from '@/lib/users'
import { normalizeText } from '@/lib/validators'
import { hashToken } from '@/lib/tokens'

export const loginUserQueryTimeoutMs = 4500

export const loginRateLimitEndpoint = '/api/auth/login' as const

export type LoginCredentials = {
  identifierType: 'phone' | 'email'
  identifier: string
  requestedPhoneCountry: PhoneCountryCode
  password: string
}

export type ParsedLoginCredentials =
  | { ok: true; credentials: LoginCredentials }
  | { ok: false; reason: 'MISSING_FIELDS' | 'INVALID_PHONE'; message: string; errors: Record<string, string> }

type LoginUser = NonNullable<Awaited<ReturnType<typeof findCompleteUserByLoginIdentifier>>>

export type CredentialAuthenticationFailure =
  | { ok: false; reason: 'ACCOUNT_NOT_FOUND'; identifierType: LoginCredentials['identifierType'] }
  | { ok: false; reason: 'ACCOUNT_DISABLED'; userId: string }
  | { ok: false; reason: 'EMAIL_UNVERIFIED'; userId: string }
  | { ok: false; reason: 'INVALID_PASSWORD'; userId: string }

export type CredentialAuthenticationResult =
  | CredentialAuthenticationFailure
  | { ok: true; user: LoginUser; passwordResult: PasswordVerifyResult }

export function parseLoginCredentials(body: unknown): ParsedLoginCredentials {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : null
  const identifierType = record?.identifierType === 'email' ? 'email' : 'phone'
  const rawIdentifier = normalizeText(record?.identifier)
  const requestedPhoneCountry: PhoneCountryCode = isSupportedPhoneCountry(record?.phoneCountry)
    ? record.phoneCountry
    : DEFAULT_PHONE_COUNTRY
  const password = typeof record?.password === 'string' ? record.password : ''

  if (!rawIdentifier || !password) {
    return {
      ok: false,
      reason: 'MISSING_FIELDS',
      message: '请填写账号和密码',
      errors: { form: '请填写账号和密码' },
    }
  }

  let identifier = identifierType === 'email' ? rawIdentifier.toLowerCase() : rawIdentifier
  if (identifierType === 'phone') {
    const phone = normalizePhoneNumber(rawIdentifier, requestedPhoneCountry)
    if (!phone) {
      const message = getPhoneValidationMessage(requestedPhoneCountry)
      return { ok: false, reason: 'INVALID_PHONE', message, errors: { identifier: message } }
    }
    identifier = phone.e164
  }

  return {
    ok: true,
    credentials: { identifierType, identifier, requestedPhoneCountry, password },
  }
}

/**
 * Web and mobile password login share the same IP/account buckets. The
 * endpoint label intentionally remains the existing web login label so a
 * caller cannot bypass the established 20-per-IP and 8-per-account policy by
 * switching route families.
 */
export async function consumeLoginRateLimit(request: Request, credentials: LoginCredentials): Promise<RateLimitResult> {
  const result = await consumeApiRateLimits(request, null, {
    endpoint: loginRateLimitEndpoint,
    ip: { limit: 20, windowSeconds: 10 * 60 },
    account: { key: `${credentials.identifierType}:${hashToken(credentials.identifier)}`, limit: 8, windowSeconds: 10 * 60 },
  })
  if (result.limited) {
    await logSecurityAbuse(request, { endpoint: loginRateLimitEndpoint, reason: 'login_rate_limit_exceeded' })
  }
  return result
}

export async function recordLoginSecurityEvent(userId: string, request: Request, reason: string) {
  await prisma.accountSecurityLog.create({
    data: {
      userId,
      action: 'LOGIN_FAILED',
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent')?.slice(0, 255) || null,
      metadata: { reason },
    },
  }).catch((error) => {
    console.warn('[auth.login.audit]', { errorName: error instanceof Error ? error.name : 'UnknownError' })
  })
}

export async function authenticateLoginCredentials(
  credentials: LoginCredentials,
  options: { onFailure?: (userId: string, reason: CredentialAuthenticationFailure['reason']) => Promise<void> } = {},
): Promise<CredentialAuthenticationResult> {
  const user = await withDbTimeout(
    'login.user-query',
    findCompleteUserByLoginIdentifier(credentials.identifierType, credentials.identifier, credentials.requestedPhoneCountry),
    loginUserQueryTimeoutMs,
  )

  if (!user) return { ok: false, reason: 'ACCOUNT_NOT_FOUND', identifierType: credentials.identifierType }

  if (user.status !== 'ACTIVE') {
    await options.onFailure?.(user.id, 'ACCOUNT_DISABLED')
    return { ok: false, reason: 'ACCOUNT_DISABLED', userId: user.id }
  }

  if (credentials.identifierType === 'email' && !user.emailVerifiedAt) {
    await options.onFailure?.(user.id, 'EMAIL_UNVERIFIED')
    return { ok: false, reason: 'EMAIL_UNVERIFIED', userId: user.id }
  }

  const passwordResult = await verifyPassword(credentials.password, user.passwordHash)
  if (!passwordResult.valid) {
    await options.onFailure?.(user.id, 'INVALID_PASSWORD')
    return { ok: false, reason: 'INVALID_PASSWORD', userId: user.id }
  }

  return { ok: true, user, passwordResult }
}

export async function rehashPasswordIfNeeded(userId: string, password: string, passwordResult: PasswordVerifyResult) {
  if (!passwordResult.needsRehash) return
  await withDbTimeout(
    'login.password-migration',
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    }),
    3000,
  )
}

export function isDatabaseTimeout(error: unknown) {
  if (error instanceof DbTimeoutError) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('timeout') || message.includes('timed out')
}
