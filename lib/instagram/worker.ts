import { randomUUID } from 'node:crypto'
import { getAnywhereDoorConfig, isAnywhereDoorSyncEnabled, ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import { runAnywhereDoorProductionPreflight } from '@/lib/instagram/production-preflight'
import { prisma } from '@/lib/prisma'
import { syncInstagramPosts, type SyncInstagramPostsResult } from '@/lib/instagram/sync-service'
import { acquireInstagramSyncLease, canStartProviderRun, getInstagramSyncState, releaseInstagramSyncLease, renewInstagramSyncLease, withInstagramLeaseTransaction, type InstagramLeaseExecutionContext, type SyncStateDb } from '@/lib/instagram/sync-state'
import { calculateNextAllowedAfterFailure, calculateNextAllowedAfterSuccess, shouldRunScheduledSync, withTimeoutAndDrain, WORKER_TIMEOUT_MS } from '@/lib/instagram/sync-policy'
import { withInstagramWorkerAdmission } from '@/lib/instagram/maintenance-protocol'

export type InstagramWorkerResult = {
  status: 'SUCCEEDED' | 'SYNC_DISABLED' | 'SKIP_ALREADY_RUNNING' | 'NOT_DUE' | 'BASELINE_REQUIRED' | 'PROVIDER_COOLDOWN' | 'PROVIDER_DAILY_CAP' | 'LOST_LEASE' | 'FAILED'
  errorCode?: string | null
  syncLogId?: string
  result?: SyncInstagramPostsResult
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  if (error instanceof Error && error.message === 'INSTAGRAM_LEASE_LOST') return 'LOST_LEASE'
  return error instanceof Error && error.message === 'SYNC_TIMEOUT' ? 'SYNC_TIMEOUT' : 'SYNC_FAILED'
}

async function recordFailure(state: Awaited<ReturnType<typeof getInstagramSyncState>>, now: Date, code: string, lease: InstagramLeaseExecutionContext, retryAfterSeconds?: number | null) {
  const consecutiveFailures = state.consecutiveFailures + 1
  return withInstagramLeaseTransaction(lease, (tx) => tx.socialSyncState.update({
    where: { id: state.id },
    data: {
      lastCheckedAt: now,
      consecutiveFailures,
      nextAllowedSyncAt: calculateNextAllowedAfterFailure({ now, consecutiveFailures, errorCode: code, retryAfterSeconds }),
      lastErrorCode: code,
      lastErrorAt: now,
      syncRequestedAt: null,
    },
  }))
}

async function recordSuccess(state: Awaited<ReturnType<typeof getInstagramSyncState>>, now: Date, result: SyncInstagramPostsResult, baseline: boolean, lease: InstagramLeaseExecutionContext) {
  const changed = result.newExternalIds.length > 0 && result.latestExternalId !== state.lastExternalId
  return withInstagramLeaseTransaction(lease, (tx) => tx.socialSyncState.update({
    where: { id: state.id },
    data: {
      lastCheckedAt: now,
      lastSuccessfulSyncAt: now,
      lastChangedAt: changed ? now : state.lastChangedAt,
      lastExternalId: result.latestExternalId || state.lastExternalId,
      consecutiveFailures: 0,
      nextAllowedSyncAt: calculateNextAllowedAfterSuccess({ now, createdCount: result.createdCount }),
      lastErrorCode: null,
      lastErrorAt: null,
      syncRequestedAt: null,
      baselineCompletedAt: baseline ? now : state.baselineCompletedAt,
    },
  }))
}

async function runInstagramSyncWorkerOnceAdmitted(input: {
  db?: SyncStateDb
  now?: Date
  target?: string
  force?: boolean
  heartbeatIntervalMs?: number
  runSync?: (options: { username: string; limit: number; baseline: boolean; baselineCompleted: boolean; lease: InstagramLeaseExecutionContext }) => Promise<SyncInstagramPostsResult>
} = {}): Promise<InstagramWorkerResult> {
  const db = input.db || prisma
  if (!isAnywhereDoorSyncEnabled()) return { status: 'SYNC_DISABLED', errorCode: 'SYNC_DISABLED' }
  const target = input.target || ANYWHERE_DOOR_TARGET
  const now = input.now || new Date()
  const config = getAnywhereDoorConfig()
  if (process.env.NODE_ENV === 'production') {
    const preflight = runAnywhereDoorProductionPreflight()
    if (!preflight.ok) return { status: 'FAILED', errorCode: preflight.issues[0] || 'CONFIG_ERROR' }
  }
  const state = await getInstagramSyncState(target, db)
  if (!input.force && !shouldRunScheduledSync(state, now)) return { status: 'NOT_DUE' }
  const failedBaselineNeedsRecovery = !state.baselineCompletedAt && Boolean(state.lastErrorAt)
  if (!state.baselineCompletedAt && !state.syncRequestedAt && !failedBaselineNeedsRecovery && !input.force) {
    return { status: 'BASELINE_REQUIRED', errorCode: 'BASELINE_REQUIRED' }
  }

  const runPermission = await canStartProviderRun(target, now, db)
  if (runPermission.runsToday >= runPermission.maxRunsPerDay) return { status: 'PROVIDER_DAILY_CAP', errorCode: 'PROVIDER_DAILY_CAP' }
  // `force` only bypasses the persisted due-time for a local/admin diagnostic;
  // it never bypasses the global billing cooldown or daily provider cap.
  if (runPermission.lastStartedAt && now.getTime() - runPermission.lastStartedAt.getTime() < config.providerRunCooldownMinutes * 60 * 1000) {
    return { status: 'PROVIDER_COOLDOWN', errorCode: 'PROVIDER_COOLDOWN' }
  }

  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? Math.max(1000, Math.floor(WORKER_TIMEOUT_MS / 3))
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1) throw new TypeError('INVALID_INSTAGRAM_HEARTBEAT_INTERVAL')
  const lease = await acquireInstagramSyncLease({ target, now, leaseMs: WORKER_TIMEOUT_MS, token: randomUUID(), db })
  if (!lease.acquired) return { status: 'SKIP_ALREADY_RUNNING', errorCode: 'SKIP_ALREADY_RUNNING' }
  if (lease.generation === null) throw new Error('INSTAGRAM_LEASE_GENERATION_MISSING')

  const controller = new AbortController()
  let lostLease = false
  let heartbeatBusy = false
  const heartbeatTimer: ReturnType<typeof setInterval> = setInterval(() => {
    if (heartbeatBusy || lostLease) return
    heartbeatBusy = true
    void renewInstagramSyncLease({ target, token: lease.token, generation: lease.generation!, now: new Date(), leaseMs: WORKER_TIMEOUT_MS, db })
      .then((renewed) => { if (!renewed) loseLease() })
      .catch(loseLease)
      .finally(() => { heartbeatBusy = false })
  }, heartbeatIntervalMs)
  const execution: InstagramLeaseExecutionContext = {
    target, token: lease.token, generation: lease.generation, db, signal: controller.signal,
    isLost: () => lostLease,
    assertActive: () => { if (lostLease || controller.signal.aborted) throw new Error('INSTAGRAM_LEASE_LOST') },
  }
  const loseLease = () => {
    if (lostLease) return
    lostLease = true
    controller.abort(new Error('INSTAGRAM_LEASE_LOST'))
  }
  heartbeatTimer.unref?.()

  let latestState = state
  try {
    latestState = await getInstagramSyncState(target, db)
    const baseline = !latestState.baselineCompletedAt
      && (Boolean(latestState.syncRequestedAt) || Boolean(latestState.lastErrorAt))
    const limit = baseline ? 20 : latestState.syncRequestedAt ? 5 : 1
    const run = input.runSync || ((options) => syncInstagramPosts({
      providerName: 'apify',
      username: options.username,
      limit: options.limit,
      baseline: options.baseline,
      suppressNotification: options.baseline,
      baselineCompleted: options.baselineCompleted,
      lease: execution,
      trigger: 'scheduled',
    }))
    const result = await withTimeoutAndDrain(run({ username: target, limit, baseline, baselineCompleted: Boolean(latestState.baselineCompletedAt), lease: execution }), WORKER_TIMEOUT_MS, loseLease)
    execution.assertActive()
    if (result.status === 'SUCCEEDED') {
      await recordSuccess(latestState, now, result, baseline, execution)
      return { status: 'SUCCEEDED', syncLogId: result.syncLogId, result }
    }
    await recordFailure(latestState, now, result.errorCode || result.status, execution, result.retryAfterSeconds)
    return { status: 'FAILED', errorCode: result.errorCode || result.status, result }
  } catch (error) {
    const code = errorCode(error)
    if (lostLease || code === 'LOST_LEASE') return { status: 'LOST_LEASE', errorCode: 'LOST_LEASE' }
    await recordFailure(latestState, now, code, execution, error && typeof error === 'object' && 'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number' ? error.retryAfterSeconds : null)
    return { status: 'FAILED', errorCode: code }
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    // A renewal may be in flight. Wait for it before releasing ownership.
    while (heartbeatBusy) await new Promise((resolve) => setTimeout(resolve, 10))
    await releaseInstagramSyncLease(target, lease.token, lease.generation, db).catch(() => undefined)
  }
}

export async function runInstagramSyncWorkerOnce(input: {
  db?: SyncStateDb
  now?: Date
  target?: string
  force?: boolean
  heartbeatIntervalMs?: number
  runSync?: (options: { username: string; limit: number; baseline: boolean; baselineCompleted: boolean; lease: InstagramLeaseExecutionContext }) => Promise<SyncInstagramPostsResult>
} = {}): Promise<InstagramWorkerResult> {
  const target = input.target || ANYWHERE_DOOR_TARGET
  const db = input.db || prisma
  if (process.env.NODE_ENV === 'test') return runInstagramSyncWorkerOnceAdmitted(input)
  return withInstagramWorkerAdmission(db as never, target, () => runInstagramSyncWorkerOnceAdmitted(input))
}
