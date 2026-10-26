export type WelcomeOptionalDataStage = 'featured-event-query' | 'featured-event-load'

type SafeErrorDetails = {
  feature: 'featured-concert'
  stage: WelcomeOptionalDataStage
  errorName: string
  errorCode?: string
}

type WelcomeOptionalDataLogger = (event: string, details: SafeErrorDetails) => void

function safeErrorDetails(error: unknown, stage: WelcomeOptionalDataStage): SafeErrorDetails {
  const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name)
    ? error.name
    : 'UnknownError'
  const candidateCode = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : null
  const errorCode = typeof candidateCode === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,47}$/.test(candidateCode)
    ? candidateCode
    : undefined

  return {
    feature: 'featured-concert',
    stage,
    errorName,
    ...(errorCode ? { errorCode } : {}),
  }
}

/**
 * The homepage concert spotlight is optional. Keep its failures from taking
 * down the core welcome page, while logging only stable, non-sensitive error
 * metadata (never the raw message, query, or stack).
 */
export async function loadWelcomeOptionalData<T>(
  stage: WelcomeOptionalDataStage,
  load: () => Promise<T | null>,
  log: WelcomeOptionalDataLogger = (event, details) => console.error(event, details),
): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    log('[welcome.optional-data.unavailable]', safeErrorDetails(error, stage))
    return null
  }
}
