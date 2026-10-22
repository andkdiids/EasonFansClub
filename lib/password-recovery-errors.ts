function safeErrorName(value: unknown) {
  const allowed = new Set([
    'Error',
    'TypeError',
    'PrismaClientKnownRequestError',
    'PrismaClientValidationError',
    'PrismaClientInitializationError',
    'PrismaClientRustPanicError',
    'RateLimitUnavailableError',
    'PasswordChangeConflictError',
  ])
  return typeof value === 'string' && allowed.has(value) ? value : 'UnknownError'
}

function safeErrorCode(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value)) return String(value)
  if (typeof value !== 'string') return undefined
  return /^(?:P\d{4}|ER_[A-Z0-9_]{1,60}|E[A-Z0-9_]{1,60})$/.test(value) ? value : undefined
}

export function describePasswordRecoveryError(error: unknown) {
  const value = error && typeof error === 'object'
    ? error as { name?: unknown; code?: unknown }
    : {}
  const errorCode = safeErrorCode(value.code)
  return {
    errorName: safeErrorName(value.name),
    errorCode,
    mysqlCode: errorCode?.startsWith('ER_') ? errorCode : undefined,
    message: 'Password recovery operation failed',
  }
}

/**
 * Log only whitelisted error classes/codes. Raw messages and Prisma metadata
 * can contain query values, hashes, identifiers, or connection information.
 */
export function logPasswordRecoveryError(route: string, error: unknown, context: Record<string, string | number | boolean | null | undefined> = {}) {
  console.error(`[${route}.error]`, {
    event: 'auth.password-recovery.failure',
    route,
    ...context,
    ...describePasswordRecoveryError(error),
  })
}
