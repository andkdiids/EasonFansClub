function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function redactSensitiveText(value: string) {
  return truncate(
    value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
      .replace(/\b(password|passwd|token|secret|cookie|authorization)\b\s*[:=]\s*[^\s&,}]+/gi, '$1=[redacted]')
      .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
      .replace(/[A-Fa-f0-9]{32,}/g, '[redacted-token]')
      .replace(/(mysql|postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]'),
    1000,
  )
}

function serializeMeta(value: unknown) {
  if (value === undefined) return undefined
  try {
    return redactSensitiveText(JSON.stringify(value))
  } catch {
    return undefined
  }
}

function extractMySqlCode(message: string) {
  return message.match(/\b(?:ER_[A-Z0-9_]+|Code\s*[:=]\s*`?(\d{3,5})`?)\b/i)?.[0]
}

export function describePasswordRecoveryError(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { errorName: 'UnknownError', errorCode: undefined, mysqlCode: undefined, message: redactSensitiveText(String(error)) }
  }

  const value = error as { name?: unknown; message?: unknown; code?: unknown; meta?: unknown }
  const message = redactSensitiveText(typeof value.message === 'string' ? value.message : String(error))
  return {
    errorName: typeof value.name === 'string' ? value.name : 'UnknownError',
    errorCode: typeof value.code === 'string' || typeof value.code === 'number' ? String(value.code) : undefined,
    mysqlCode: extractMySqlCode(message),
    prismaMeta: serializeMeta(value.meta),
    message,
  }
}

/**
 * Keep the provider/database diagnostic in server logs without ever logging
 * request credentials, reset tokens, or full email addresses.
 */
export function logPasswordRecoveryError(route: string, error: unknown, context: Record<string, string | number | boolean | null | undefined> = {}) {
  console.error(`[${route}.error]`, {
    event: 'auth.password-recovery.failure',
    route,
    ...context,
    ...describePasswordRecoveryError(error),
  })
}
