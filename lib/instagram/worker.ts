import { randomUUID } from 'node:crypto'
import { getAnywhereDoorConfig, isAnywhereDoorSyncEnabled, ANYWHERE_DOOR_TARGET } from '@/lib/anywhere-door/config'
import { runAnywhereDoorProductionPreflight } from '@/lib/instagram/production-preflight'
import { prisma } from '@/lib/prisma'
import { syncInstagramPosts, type SyncInstagramPostsResult } from '@/lib/instagram/sync-service'
import { acquireInstagramSyncLease, canStartProviderRun, getInstagramSyncState, releaseInstagramSyncLease, type SyncStateDb } from '@/lib/instagram/sync-state'
import { calculateNextAllowedAfterFailure, calculateNextAllowedAfterSuccess, shouldRunScheduledSync, withTimeout, WORKER_TIMEOUT_MS } from '@/lib/instagram/sync-policy'

export type InstagramWorkerResult = {
  status: 'SUCCEEDED' | 'SYNC_DISABLED' | 'SKIP_ALREADY_RUNNING' | 'NOT_DUE' | 'BASELINE_REQUIRED' | 'PROVIDER_COOLDOWN' | 'PROVIDER_DAILY_CAP' | 'FAILED'
  errorCode?: string | null
  syncLogId?: string
  result?: SyncInstagramPostsResult
}

function errorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return error instanceof Error && error.message === 'SYNC_TIMEOUT' ? 'SYNC_TIMEOUT' : 'SYNC_FAILED'
}

async function recordFailure(db: SyncStateDb, state: Awaited<ReturnType<typeof getInstagramSyncState>>, now: Date, code: string, retryAfterSeconds?: number | null) {
  const consecutiveFailures = state.consecutiveFailures + 1
  return db.socialSyncState.update({
    where: { id: state.id },
    data: {
      lastCheckedAt: now,
      consecutiveFailures,
      nextAllowedSyncAt: calculateNextAllowedAfterFailure({ now, consecutiveFailures, errorCode: code, retryAfterSeconds }),
      lastErrorCode: code,
      lastErrorAt: now,
      syncRequestedAt: null,
    },
  })
}

async function recordSuccess(db: SyncStateDb, state: Awaited<ReturnType<typeof getInstagramSyncState>>, now: Date, result: SyncInstagramPostsResult, baseline: boolean) {
  const changed = result.newExternalIds.length > 0 && result.latestExternalId !== state.lastExternalId
  return db.socialSyncState.update({
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
  })
}

export async function runInstagramSyncWorkerOnce(input: {
  db?: SyncStateDb
  now?: Date
  target?: string
  force?: boolean
  runSync?: (options: { username: string; limit: number; baseline: boolean; baselineCompleted: boolean }) => Promise<SyncInstagramPostsResult>
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
  if (!state.baselineCompletedAt && !state.syncRequestedAt && !input.force) return { status: 'BASELINE_REQUIRED', errorCode: 'BASELINE_REQUIRED' }

  const runPermission = await canStartProviderRun(target, now, db)
  if (runPermission.runsToday >= runPermission.maxRunsPerDay) return { status: 'PROVIDER_DAILY_CAP', errorCode: 'PROVIDER_DAILY_CAP' }
  // `force` only bypasses the persisted due-time for a local/admin diagnostic;
  // it never bypasses the global billing cooldown or daily provider cap.
  if (runPermission.lastStartedAt && now.getTime() - runPermission.lastStartedAt.getTime() < config.providerRunCooldownMinutes * 60 * 1000) {
    return { status: 'PROVIDER_COOLDOWN', errorCode: 'PROVIDER_COOLDOWN' }
  }

  const lease = await acquireInstagramSyncLease({ target, now, leaseMs: WORKER_TIMEOUT_MS, token: randomUUID(), db })
  if (!lease.acquired) return { status: 'SKIP_ALREADY_RUNNING', errorCode: 'SKIP_ALREADY_RUNNING' }

  const latestState = await getInstagramSyncState(target, db)
  const baseline = !latestState.baselineCompletedAt && Boolean(latestState.syncRequestedAt)
  const limit = baseline ? 20 : latestState.syncRequestedAt ? 5 : 1
  try {
    const run = input.runSync || ((options) => syncInstagramPosts({
      providerName: 'apify',
      username: options.username,
      limit: options.limit,
      baseline: options.baseline,
      suppressNotification: options.baseline,
      baselineCompleted: options.baselineCompleted,
      trigger: 'scheduled',
    }))
    const result = await withTimeout(run({ username: target, limit, baseline, baselineCompleted: Boolean(latestState.baselineCompletedAt) }), WORKER_TIMEOUT_MS)
    if (result.status === 'SUCCEEDED') {
      await recordSuccess(db, latestState, now, result, baseline)
      return { status: 'SUCCEEDED', syncLogId: result.syncLogId, result }
    }
    await recordFailure(db, latestState, now, result.errorCode || result.status, result.retryAfterSeconds)
    return { status: 'FAILED', errorCode: result.errorCode || result.status, result }
  } catch (error) {
    const code = errorCode(error)
    await recordFailure(db, latestState, now, code, error && typeof error === 'object' && 'retryAfterSeconds' in error && typeof error.retryAfterSeconds === 'number' ? error.retryAfterSeconds : null)
    return { status: 'FAILED', errorCode: code }
  } finally {
    await releaseInstagramSyncLease(target, lease.token, db).catch(() => undefined)
  }
}
