const CHECKIN_ROUTE = '/api/checkin'

export type CheckInRequestTiming = {
  requestId: string
  method: 'GET' | 'POST'
  route?: string
  userId?: string
  totalMs: number
  authMs?: number
  rateLimitMs?: number
  precheckMs?: number
  transactionMs?: number
  postCriticalMs?: number
  responseBuildMs?: number
  dbStatsMs?: number
  dateKey?: string
  success: boolean
  errorCode?: string
}

export type CheckInBackgroundTaskLog = {
  requestId: string
  userId: string
  backgroundTask: string
  durationMs: number
  success: boolean
  errorCode?: string
}

function thresholdFor(method: CheckInRequestTiming['method']) {
  return method === 'GET' ? 800 : 1200
}

/**
 * Keep performance logs deliberately small. Error messages, headers and request
 * bodies are intentionally not accepted here so a future caller cannot leak a
 * token, cookie, phone number or full client IP by accident.
 */
export function logSlowCheckInRequest(input: CheckInRequestTiming) {
  const totalMs = Math.max(0, Math.round(input.totalMs))
  const shouldLog = !input.success || totalMs > thresholdFor(input.method)
  if (!shouldLog) return

  const payload = {
    event: input.success ? 'checkin.slow_request' : 'checkin.request_error',
    route: input.route || CHECKIN_ROUTE,
    method: input.method,
    requestId: input.requestId,
    userId: input.userId,
    totalMs,
    authMs: input.authMs,
    rateLimitMs: input.rateLimitMs,
    precheckMs: input.precheckMs,
    transactionMs: input.transactionMs,
    postCriticalMs: input.postCriticalMs,
    responseBuildMs: input.responseBuildMs,
    dbStatsMs: input.dbStatsMs,
    dateKey: input.dateKey,
    success: input.success,
    errorCode: input.errorCode,
  }
  console.warn('[checkin.performance]', payload)
}

export function logCheckInBackgroundTask(input: CheckInBackgroundTaskLog) {
  console.info('[checkin.background_task]', {
    event: 'checkin.background_task',
    route: CHECKIN_ROUTE,
    method: 'POST',
    requestId: input.requestId,
    userId: input.userId,
    backgroundTask: input.backgroundTask,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    success: input.success,
    errorCode: input.errorCode,
  })
}

export function safeErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return undefined
  const candidate = (error as { code?: unknown }).code
  if (typeof candidate === 'string' && /^[A-Z0-9_.-]{1,80}$/.test(candidate)) return candidate
  const name = (error as { name?: unknown }).name
  if (typeof name === 'string' && /^[A-Za-z0-9_.-]{1,80}$/.test(name)) return name
  return undefined
}
