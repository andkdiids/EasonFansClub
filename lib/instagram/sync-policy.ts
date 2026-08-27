import {
  DEFAULT_PROVIDER_RUN_COOLDOWN_MINUTES,
  DEFAULT_SYNC_IDLE_INTERVAL_MINUTES,
  DEFAULT_SYNC_NORMAL_INTERVAL_MINUTES,
  getAnywhereDoorConfig,
} from '@/lib/anywhere-door/config'

export const WORKER_TIMEOUT_MS = 5 * 60 * 1000
export const PROVIDER_RATE_LIMIT_FALLBACK_MS = 6 * 60 * 60 * 1000
export const PROVIDER_AUTH_SUSPENSION_MS = 24 * 60 * 60 * 1000

export const FAILURE_BACKOFF_MINUTES = [30, 60, 180] as const
export const FAILURE_BACKOFF_CAP_MINUTES = 6 * 60

export type SyncScheduleState = {
  nextAllowedSyncAt: Date | null
  syncRequestedAt: Date | null
  baselineCompletedAt: Date | null
  lastSuccessfulSyncAt: Date | null
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000)
}

export function calculateFailureBackoffMinutes(consecutiveFailures: number) {
  const index = Math.max(0, Math.floor(consecutiveFailures) - 1)
  return FAILURE_BACKOFF_MINUTES[index] || FAILURE_BACKOFF_CAP_MINUTES
}

export function calculateNextAllowedAfterFailure(input: {
  now?: Date
  consecutiveFailures: number
  errorCode?: string | null
  retryAfterSeconds?: number | null
}) {
  const now = input.now || new Date()
  if (input.errorCode === 'PROVIDER_RATE_LIMITED' || input.errorCode === 'RATE_LIMITED') {
    const retryAfterMs = Number.isFinite(input.retryAfterSeconds) && Number(input.retryAfterSeconds) > 0
      ? Number(input.retryAfterSeconds) * 1000
      : PROVIDER_RATE_LIMIT_FALLBACK_MS
    return new Date(now.getTime() + retryAfterMs)
  }
  if (input.errorCode === 'PROVIDER_AUTH_ERROR') return new Date(now.getTime() + PROVIDER_AUTH_SUSPENSION_MS)
  return addMinutes(now, calculateFailureBackoffMinutes(input.consecutiveFailures))
}

export function calculateNextAllowedAfterSuccess(input: { now?: Date; createdCount: number; normalIntervalMinutes?: number; idleIntervalMinutes?: number }) {
  const config = getAnywhereDoorConfig()
  const now = input.now || new Date()
  const normal = input.normalIntervalMinutes || config.normalIntervalMinutes || DEFAULT_SYNC_NORMAL_INTERVAL_MINUTES
  const idle = input.idleIntervalMinutes || config.idleIntervalMinutes || DEFAULT_SYNC_IDLE_INTERVAL_MINUTES
  return addMinutes(now, input.createdCount > 0 ? normal : idle)
}

export function isSyncCoolingDown(lastStartedAt: Date | null | undefined, now = new Date(), cooldownMinutes = DEFAULT_PROVIDER_RUN_COOLDOWN_MINUTES) {
  return Boolean(lastStartedAt && now.getTime() - lastStartedAt.getTime() < cooldownMinutes * 60 * 1000)
}

export function shouldRunScheduledSync(state: SyncScheduleState, now = new Date()) {
  if (state.syncRequestedAt && state.syncRequestedAt <= now) return true
  if (!state.nextAllowedSyncAt) return true
  return state.nextAllowedSyncAt <= now
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs = WORKER_TIMEOUT_MS, error = new Error('SYNC_TIMEOUT')) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(error), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
