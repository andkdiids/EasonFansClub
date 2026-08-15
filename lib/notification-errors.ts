type NotificationErrorContext = Record<string, string | number | boolean | null | undefined>

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

function redactSensitiveText(value: string) {
  return truncate(
    value
      .replace(/\b(password|passwd|token|secret|cookie|authorization)\b\s*[:=]\s*[^\s&]+/gi, '$1=[redacted]')
      .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
      .replace(/(mysql|postgres(?:ql)?:\/\/)[^\s]+/gi, '$1[redacted]'),
    1000,
  )
}

export function describeNotificationError(error: unknown) {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: unknown }
    return {
      errorName: error.name,
      errorCode: typeof errorWithCode.code === 'string' || typeof errorWithCode.code === 'number'
        ? String(errorWithCode.code)
        : undefined,
      message: redactSensitiveText(error.message),
      stack: error.stack ? redactSensitiveText(error.stack) : undefined,
    }
  }

  return {
    errorName: 'UnknownError',
    errorCode: undefined,
    message: redactSensitiveText(String(error)),
    stack: undefined,
  }
}

export function logNotificationError(
  phase: string,
  context: NotificationErrorContext,
  error: unknown,
) {
  console.error(`[notifications.${phase}.error]`, {
    ...context,
    ...describeNotificationError(error),
  })
}
