import { getGlobalPointsGrantWorkerBatchCandidates, processGlobalPointsGrantBatchChunk } from '@/lib/global-points-grant'
import { GLOBAL_POINTS_GRANT_WORKER_INTERVAL_MS } from '@/lib/global-points-grant-constants'

const WORKER_BATCH_LIMIT = 4

let workerRunning = false

export async function runGlobalPointsGrantWorkerOnce() {
  if (workerRunning) return { skipped: true, batches: 0, processed: 0 }
  workerRunning = true
  try {
    const candidates = await getGlobalPointsGrantWorkerBatchCandidates(WORKER_BATCH_LIMIT)
    let processed = 0
    for (const candidate of candidates) {
      try {
        const result = await processGlobalPointsGrantBatchChunk(candidate.id)
        processed += result.pointsSuccessCount + result.pointsFailedCount + result.notificationSuccessCount + result.notificationFailedCount
        if (result.pointsSuccessCount || result.pointsFailedCount || result.notificationSuccessCount || result.notificationFailedCount) {
          console.info('[global-points-grant.worker.progress]', {
            batchId: candidate.id,
            status: result.batch.status,
            processedCount: result.batch.processedCount,
            totalCount: result.batch.recipientCount,
            successCount: result.batch.successCount,
            failedCount: result.batch.failedCount,
            notificationSuccessCount: result.batch.notificationSuccessCount,
            notificationFailedCount: result.batch.notificationFailedCount,
          })
        }
      } catch (error) {
        console.error('[global-points-grant.worker.batch-failed]', {
          batchId: candidate.id,
          errorName: error instanceof Error ? error.name : 'UNKNOWN',
        })
      }
    }
    return { skipped: false, batches: candidates.length, processed }
  } finally {
    workerRunning = false
  }
}

export function startGlobalPointsGrantWorker() {
  let stopped = false
  const tick = () => {
    if (stopped) return
    void runGlobalPointsGrantWorkerOnce().catch((error) => {
      console.error('[global-points-grant.worker.failed]', {
        errorName: error instanceof Error ? error.name : 'UNKNOWN',
      })
    })
  }
  const heartbeat = setInterval(tick, GLOBAL_POINTS_GRANT_WORKER_INTERVAL_MS)
  tick()
  return () => {
    stopped = true
    clearInterval(heartbeat)
  }
}
